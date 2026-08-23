/**
 * The sitemap that makes a customer's page findable at all.
 *
 * Allowing /r/ in robots.txt fixed link previews and nothing else: those pages
 * are linked from nowhere but a QR code on a table, so a crawler can fetch
 * them but cannot discover them. This file is the discovery path.
 *
 * Which makes it a file that asks Google to index things, and the tests worth
 * having are the ones about what must never be asked for: a demo page carrying
 * a stranger's business name, and a restaurant that stopped paying.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { onRequestGet } from './routes/restaurant-sitemap.js';

const ENV = {
  DATA_BACKEND: 'supabase',
  SUPABASE_URL: 'https://stub.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
};

const DAY = 86400000;
const future = () => Date.now() + 30 * DAY;
const past = () => Date.now() - 30 * DAY;

/** Answers the PostgREST shape worker/lib/db.js speaks, with `rows`. */
function stub(rows, { throws = false } = {}) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    if (throws) throw new Error('database is down');
    return new Response(JSON.stringify(rows), { status: 200 });
  };
  return () => { globalThis.fetch = original; };
}

async function sitemap(rows, opts) {
  const restore = stub(rows, opts);
  try {
    const res = await onRequestGet({ env: ENV });
    return { res, body: await res.text() };
  } finally {
    restore();
  }
}

const paying = (slug) => ({ slug, demo: false, plan: 'active', current_period_end: future() });

test('a paying restaurant is listed', async () => {
  const { res, body } = await sitemap([paying('test-kitchen')]);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/xml/);
  assert.match(body, /<loc>https:\/\/billtap\.app\/r\/test-kitchen<\/loc>/);
});

test('a demo page is never submitted for indexing', async () => {
  /**
   * The one that matters most. A demo carries a real business's name, that
   * business agreed to nothing, and the row is deleted within the day. A
   * sitemap is an explicit request to index — asking Google to rank a page we
   * are about to delete, for somebody else's restaurant, is the exact harm the
   * noindex and the random slug exist to prevent.
   */
  const { body } = await sitemap([
    paying('test-kitchen'),
    { slug: 'rs-5xvmph', demo: true, demo_expires_at: future(), plan: 'trial' },
  ]);
  assert.match(body, /test-kitchen/);
  assert.ok(!body.includes('rs-5xvmph'), 'a demo slug reached the sitemap');
});

test('a reference account is never submitted for indexing', async () => {
  /**
   * The one that nearly shipped.
   *
   * `reference_account` keeps a row off the billing clock and says nothing
   * about consent to be published. The only row carrying it in production is
   * a prospect who has not said yes -- src/pages/Restaurants.jsx names them
   * and explains that a fabricated claim they were a customer was already
   * deleted from the marketing page once, because the owner can read that
   * page and would be right to walk.
   *
   * Listing one here makes that claim again, to Google, and puts a page
   * bearing a real business's name into search results. It is the demo harm
   * exactly, sneaking past every demo protection because `demo` is false.
   */
  const { body } = await sitemap([
    paying('a-real-customer'),
    { slug: 'test-kitchen', demo: false, reference_account: true, plan: 'trial', trial_ends_at: past() },
  ]);
  assert.match(body, /a-real-customer/);
  assert.ok(!body.includes('test-kitchen'), 'a reference account reached a public customer list');
});

test('a restaurant that stopped paying is not kept in the index queue', async () => {
  // SEO is part of what the $149 buys. Their page still works for guests --
  // see shared/entitlement.js -- but we stop asking Google to rank it.
  const { body } = await sitemap([
    paying('current'),
    { slug: 'cancelled-place', demo: false, plan: 'cancelled' },
    { slug: 'lapsed-trial', demo: false, plan: 'trial', trial_ends_at: past() },
  ]);
  assert.match(body, /current/);
  assert.ok(!body.includes('cancelled-place'));
  assert.ok(!body.includes('lapsed-trial'));
});

test('a trial that is still running counts as paying', async () => {
  // Fourteen free days are still the product being delivered.
  const { body } = await sitemap([
    { slug: 'new-signup', demo: false, plan: 'trial', trial_ends_at: future() },
  ]);
  assert.match(body, /new-signup/);
});

test('nothing but the slug is exposed', async () => {
  // The row carries the owner, the alert address and the Stripe ids. A public
  // unauthenticated URL is exactly where a spread would leak them.
  const { body } = await sitemap([{
    ...paying('test-kitchen'),
    alert_email: 'gm@test-kitchen.example',
    owner_id: 'user_secret',
    stripe_subscription_id: 'sub_live_123',
  }]);
  for (const secret of ['gm@test-kitchen.example', 'user_secret', 'sub_live_123', 'active']) {
    assert.ok(!body.includes(secret), `${secret} reached a public sitemap`);
  }
});

test('an empty customer list is still a valid sitemap', async () => {
  const { res, body } = await sitemap([]);
  assert.equal(res.status, 200);
  assert.match(body, /<urlset/);
  assert.match(body, /<\/urlset>/);
  assert.ok(!body.includes('<loc>'));
});

test('a database failure answers an empty sitemap, not a 500', async () => {
  /**
   * A crawler that receives an error on a sitemap it was told to read may keep
   * the old contents or may drop them, and neither is under our control. An
   * honest empty document costs nothing: a page already indexed is not removed
   * by its absence here.
   */
  const { res, body } = await sitemap([], { throws: true });
  assert.equal(res.status, 200);
  assert.match(body, /<urlset/);
});

test('the response is cached, so a crawler cannot bill us per hit', async () => {
  // Public, unauthenticated, and backed by a database read. Without a cache
  // header that is a free denial-of-wallet button.
  const { res } = await sitemap([paying('test-kitchen')]);
  assert.match(res.headers.get('cache-control'), /max-age=\d+/);
});

test('a slug that would break the XML is escaped', async () => {
  // Slugs are [a-z0-9-] by construction, so this should never fire. An
  // unescaped ampersand does not fail loudly — it silently invalidates the
  // document for every crawler that reads it, which is why the guard exists
  // for rows that predate the rule.
  const { body } = await sitemap([paying('a&b')]);
  assert.ok(!/<loc>[^<]*&(?!amp;|lt;|gt;|quot;|apos;)/.test(body), 'raw ampersand in output');
  assert.match(body, /a&amp;b/);
});
