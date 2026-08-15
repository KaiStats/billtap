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

test('the low-rating alert fires for a demo page', async () => {
  /**
   * The single assertion this whole feature is built around.
   *
   * The demo that closes is the owner tapping two stars and the alert arriving
   * while he is holding the phone. Every hand-made demo row before this one
   * stopped doing that fourteen days after it was typed, silently, because
   * `trial_ends_at` ran out and the gate above answered `not_entitled` — a 200
   * with nothing sent, at the exact moment somebody was watching.
   *
   * `plan: 'trial'` with a long-dead `trial_ends_at` on purpose: that is the
   * shape the row actually has, and this is the test that fails if the demo arm
   * in shared/entitlement.js is ever moved below the rest of the function.
   */
  const demo = {
    ...PAYING(),
    id: 'r1', name: 'Herb and Rye', slug: 'hr-a7f3kq',
    alert_email: 'kai@billtap.app',
    google_review_url: null,
    plan: 'trial', current_period_end: null, trial_ends_at: Date.now() - 30 * DAY,
    demo: true, demo_expires_at: Date.now() + 6 * 3600000,
  };
  const rating = { id: 'gr1', restaurant_id: 'r1', stars: 2, comment: 'demo tap', alerted_at: null };

  await withStub({ restaurants: [demo], ratings: [rating] }, async ({ emails }) => {
    const res = await alertFor();
    assert.equal(res.status, 200);
    assert.equal(emails.length, 1, 'the phone has to buzz while the prospect is holding it');
    assert.equal(emails[0].To, 'kai@billtap.app', 'and it reaches the operator, never the prospect');
  });
});

test('an expired demo is not paged', async () => {
  // Unreachable in practice — the nightly job deletes these rows — but the
  // state exists for the night it does not run, and a page that keeps alerting
  // for a business that never agreed to it is the wrong way to degrade.
  const demo = {
    ...PAYING(),
    plan: 'trial', current_period_end: null, trial_ends_at: null,
    demo: true, demo_expires_at: Date.now() - 3600000,
  };
  const rating = { id: 'gr1', restaurant_id: 'r1', stars: 2, alerted_at: null };
  await withStub({ restaurants: [demo], ratings: [rating] }, async ({ emails }) => {
    const body = await (await alertFor()).json();
    assert.equal(emails.length, 0);
    assert.equal(body.skipped, 'not_entitled');
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

// ── Which table is unhappy ──────────────────────────────────────────────────
//
// The alert said "Unhappy guest — still on site" and nothing else, which leaves
// a manager to walk a forty-table room squinting at people. BillTap has no
// concept of a table — one QR goes on every tent — but guest_ratings.session_id
// has always pointed at the actual bill, and this endpoint never read it. The
// check total is what finds the table: typed into the POS it returns the
// ticket, and the ticket knows the table and the server.

const RATED_SESSION = () => ({
  id: 's_dinner',
  restaurant_id: 'r1',
  total_amount: 87.4,
  participants: [
    { participant_id: 'p_1_a', name: 'Marcus' },
    { participant_id: 'p_2_b', name: 'Priya' },
    { participant_id: 'p_3_c', name: 'Dana' },
    { participant_id: 'p_4_d', name: 'Sam' },
  ],
  image_url: 'https://stub.supabase.co/storage/v1/object/public/receipts/abc-123.jpg',
});

test('the alert carries the check total, so the ticket can be found', async () => {
  const rating = { id: 'gr1', restaurant_id: 'r1', session_id: 's_dinner', stars: 2, comment: 'cold food', alerted_at: null };
  await withStub({ restaurants: [PAYING()], ratings: [rating] }, async ({ emails, tables }) => {
    tables.sessions = [RATED_SESSION()];
    await alertFor();

    assert.equal(emails.length, 1);
    const { HtmlBody, TextBody } = emails[0];

    assert.match(HtmlBody, /\$87\.40/, 'the total is what a manager types into the POS');
    assert.match(HtmlBody, /4 guests/);
    assert.match(HtmlBody, /receipts\/abc-123\.jpg/, 'and the actual bill is one tap away');
    // The plain-text part is what a watch shows, so it carries it too.
    assert.match(TextBody, /\$87\.40/);
    assert.match(TextBody, /4 guests/);
  });
});

test('guest names are deliberately not in the alert', async () => {
  /**
   * src/pages/Privacy.jsx publishes that guest display names are removed thirty
   * days after a session completes. An email is somewhere that promise cannot
   * reach — a name mailed today sits in an inbox forever. The count identifies
   * the table just as well and the total identifies the ticket, so the names
   * would buy nothing at the price of a published commitment.
   */
  const rating = { id: 'gr1', restaurant_id: 'r1', session_id: 's_dinner', stars: 2, alerted_at: null };
  await withStub({ restaurants: [PAYING()], ratings: [rating] }, async ({ emails, tables }) => {
    tables.sessions = [RATED_SESSION()];
    await alertFor();

    const body = emails[0].HtmlBody + emails[0].TextBody;
    for (const name of ['Marcus', 'Priya', 'Dana', 'Sam']) {
      assert.ok(!body.includes(name), `${name} must not travel in an email`);
    }
  });
});

test('a rating with no split still pages, just with less detail', async () => {
  // session_id is nullable, and `on delete set null` clears it when a split is
  // redacted out from under a rating. Neither is a reason to withhold the one
  // notification the restaurant is paying for.
  const rating = { id: 'gr1', restaurant_id: 'r1', session_id: null, stars: 1, alerted_at: null };
  await withStub({ restaurants: [PAYING()], ratings: [rating] }, async ({ emails }) => {
    const res = await alertFor();
    assert.equal(res.status, 200);
    assert.equal(emails.length, 1, 'the page still goes out');
    assert.ok(!emails[0].HtmlBody.includes('Find the table'));
  });
});

test('a split that cannot be read does not cost the operator the alert', async () => {
  // Decoration on the paid half of the product. A read that times out, or a
  // session deleted between the rating and the page, must cost detail and
  // never the page itself.
  const rating = { id: 'gr1', restaurant_id: 'r1', session_id: 's_gone', stars: 2, alerted_at: null };
  await withStub({ restaurants: [PAYING()], ratings: [rating] }, async ({ emails, tables }) => {
    tables.sessions = [];
    const res = await alertFor();
    assert.equal(res.status, 200);
    assert.equal(emails.length, 1);
    assert.match(emails[0].HtmlBody, /2 of 5|★/, 'the rating itself is still reported');
  });
});

test('a demo split shows its total too, so the demo shows the real thing', async () => {
  // "Skip setup, split evenly" is how a demo bill gets made, so it has a total
  // and one participant and no receipt. The alert should look like the real
  // one, minus what genuinely is not there.
  const demo = {
    ...PAYING(),
    plan: 'trial', current_period_end: null, trial_ends_at: Date.now() - 30 * DAY,
    demo: true, demo_expires_at: Date.now() + 6 * 3600000,
  };
  const rating = { id: 'gr1', restaurant_id: 'r1', session_id: 's_demo', stars: 2, alerted_at: null };
  await withStub({ restaurants: [demo], ratings: [rating] }, async ({ emails, tables }) => {
    tables.sessions = [{ id: 's_demo', restaurant_id: 'r1', total_amount: 40, participants: [{ participant_id: 'p_1_a', name: 'You' }], image_url: null }];
    await alertFor();

    assert.equal(emails.length, 1);
    assert.match(emails[0].HtmlBody, /\$40\.00/);
    assert.match(emails[0].HtmlBody, /1 guest(?!s)/, 'singular, because "1 guests" reads as a bug');
    assert.ok(!emails[0].HtmlBody.includes('See the receipt'), 'no receipt was photographed');
  });
});
