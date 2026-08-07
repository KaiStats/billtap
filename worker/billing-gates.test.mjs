/**
 * What actually stops when a restaurant is not paying — and what must not.
 *
 * The entitlement rule is tested next door. These are the three places it is
 * applied, and the several places it is deliberately not, because the second
 * list is the one that gets broken by accident later.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HANDLERS } from './routes/functions.js';
import { onRequestPost as ratingAlert } from './routes/rating-alert.js';

const ENV = {
  DATA_BACKEND: 'supabase',
  SUPABASE_URL: 'https://stub.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  SUPABASE_ANON_KEY: 'anon-key',
  POSTMARK_SERVER_TOKEN: 'postmark-token',
  ENVIRONMENT: 'production',
};

const DAY = 86400000;
const PAYING = () => ({
  id: 'r1', name: 'Mariposa', slug: 'mariposa',
  google_review_url: 'https://g.page/r/CX0/review',
  alert_email: 'gm@mariposa.example',
  rating_threshold: 4,
  plan: 'active', current_period_end: Date.now() + 20 * DAY,
});
const EXPIRED = () => ({ ...PAYING(), plan: 'trial', current_period_end: null, trial_ends_at: Date.now() - DAY });

/** Stub covering the PostgREST shape plus Postmark, recording what was sent. */
function stub({ restaurants = [], ratings = [] } = {}) {
  const original = globalThis.fetch;
  const tables = { restaurants: structuredClone(restaurants), guest_ratings: structuredClone(ratings) };
  const emails = [];

  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (u.hostname.includes('postmarkapp.com')) {
      emails.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ MessageID: 'm1' }), { status: 200 });
    }
    if (u.pathname.includes('/auth/v1/user')) {
      return new Response(JSON.stringify({ error: 'anonymous' }), { status: 401 });
    }
    const from = u.pathname.replace('/rest/v1/', '').split('?')[0];
    const rows = tables[from] || (tables[from] = []);
    const method = init.method || 'GET';
    const match = (row) => [...u.searchParams].every(([k, v]) => {
      if (['select', 'order', 'limit', 'offset'].includes(k)) return true;
      return !String(v).startsWith('eq.') || String(row[k]) === String(v).slice(3);
    });
    if (method === 'PATCH') {
      const hit = rows.filter(match);
      for (const row of hit) Object.assign(row, JSON.parse(init.body));
      return new Response(JSON.stringify(hit), { status: 200 });
    }
    if (method === 'POST') {
      const row = { id: 'new', ...JSON.parse(init.body) };
      rows.push(row);
      return new Response(JSON.stringify([row]), { status: 201 });
    }
    return new Response(JSON.stringify(rows.filter(match)), { status: 200 });
  };

  return { tables, emails, restore: () => { globalThis.fetch = original; } };
}

async function withStub(opts, fn) {
  const s = stub(opts);
  try { return await fn(s); } finally { s.restore(); }
}

const publicLookup = (slug = 'mariposa') =>
  HANDLERS.getPublicRestaurant({
    env: ENV,
    request: new Request('https://billtap.app/api/fn/getPublicRestaurant', { method: 'POST' }),
    body: { slug },
    audit: async () => {},
  });

const alertFor = (ratingId = 'gr1') =>
  ratingAlert({
    env: ENV,
    request: new Request('https://billtap.app/api/rating-alert', {
      method: 'POST',
      body: JSON.stringify({ rating_id: ratingId }),
    }),
  });

// ── The Google handoff ──────────────────────────────────────────────────────

test('a paying restaurant hands its guests the review link', async () => {
  await withStub({ restaurants: [PAYING()] }, async () => {
    const out = await (await publicLookup()).json();
    assert.equal(out.restaurant.google_review_url, 'https://g.page/r/CX0/review');
  });
});

test('an unpaid one hands out nothing, and the guest sees no error', async () => {
  // Withheld server-side rather than blocked in the client: RatingCapture
  // already disables the button on a null URL, so this needs no new branch and
  // shows the guest nothing that reads as a fault of theirs.
  await withStub({ restaurants: [EXPIRED()] }, async () => {
    const res = await publicLookup();
    const out = await res.json();
    assert.equal(res.status, 200, 'still a normal answer — the guest did nothing wrong');
    assert.equal(out.restaurant.google_review_url, null);
    assert.equal(out.restaurant.name, 'Mariposa', 'the rest of the screen still works');
    assert.equal(out.restaurant.rating_threshold, 4);
  });
});

test('withholding the link does not delete it', async () => {
  // Paying turns the button back on. Clearing the column would make an
  // operator re-find their Google review URL to resubscribe.
  await withStub({ restaurants: [EXPIRED()] }, async ({ tables }) => {
    await publicLookup();
    assert.equal(tables.restaurants[0].google_review_url, 'https://g.page/r/CX0/review');
  });
});

// ── The low-rating alert ────────────────────────────────────────────────────

test('a paying restaurant is paged about an unhappy guest', async () => {
  const rating = { id: 'gr1', restaurant_id: 'r1', stars: 2, comment: 'cold food', alerted_at: null };
  await withStub({ restaurants: [PAYING()], ratings: [rating] }, async ({ emails }) => {
    const res = await alertFor();
    assert.equal(res.status, 200);
    assert.equal(emails.length, 1);
    assert.equal(emails[0].To, 'gm@mariposa.example');
  });
});

test('an unpaid one is not, and the rating is left deliverable', async () => {
  const rating = { id: 'gr1', restaurant_id: 'r1', stars: 2, comment: 'cold food', alerted_at: null };
  await withStub({ restaurants: [EXPIRED()], ratings: [rating] }, async ({ emails, tables }) => {
    const res = await alertFor();
    const body = await res.json();

    assert.equal(emails.length, 0, 'no page for a restaurant that is not paying');
    assert.equal(res.status, 200, 'a 200, because the guest is watching this call');
    assert.equal(body.skipped, 'not_entitled');
    // The half that matters most on the way back: `alerted_at` unstamped, so
    // this alert can still be delivered if they resubscribe. Stamping it would
    // quietly consume the notification.
    assert.equal(tables.guest_ratings[0].alerted_at, null);
  });
});

// ── What billing must never touch ───────────────────────────────────────────

test('a guest can still rate an unpaid restaurant, and it is still stored', async () => {
  // The rating is the restaurant's data. Refusing to record it destroys
  // something unrecoverable to enforce a debt the guest has nothing to do with.
  await withStub({ restaurants: [EXPIRED()] }, async ({ tables }) => {
    tables.sessions = [{ id: 's1', restaurant_id: 'r1', status: 'completed' }];
    const res = await HANDLERS.submitGuestRating({
      env: ENV,
      request: new Request('https://billtap.app/api/fn/submitGuestRating', { method: 'POST' }),
      body: { action: 'rate', session_id: 's1', stars: 2 },
      audit: async () => {},
    });
    assert.equal(res.status, 200);
    assert.equal(tables.guest_ratings.length, 1, 'stored, waiting for them to pay');
    assert.equal(tables.guest_ratings[0].stars, 2);
  });
});

test('the public lookup still answers for an unpaid restaurant at all', async () => {
  // A 404 or a 403 here would break the table-tent QR — /r/<slug> would stop
  // resolving and a diner would be unable to split their bill because of
  // somebody else's invoice.
  await withStub({ restaurants: [EXPIRED()] }, async () => {
    const res = await publicLookup();
    assert.equal(res.status, 200);
  });
});
