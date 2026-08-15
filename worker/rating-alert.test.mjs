/**
 * The low-rating alert.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * It did not, and the endpoint had a bug that stopped every alert from being
 * sent: stampAlerted() called base44Origin(env) without env being one of its
 * parameters, so it threw ReferenceError, its own catch swallowed that and
 * returned false, and the caller read false as "could not claim the alert,
 * refusing to send". Against a perfectly healthy upstream, with every
 * credential correct, no operator was ever paged.
 *
 * Nothing surfaced it. The browser fires this best-effort and never reads the
 * response, so the failure had no route to a human.
 *
 * This is the retention feature the product is sold on — an unhappy guest is
 * caught while still at the table. It is worth a test file.
 *
 * The stub is an in-memory data layer over fetch, matching worker/api.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost } from './routes/rating-alert.js';

const ENV = {
  ENVIRONMENT: 'production',
  BASE44_APP_ID: 'app1',
  PRODUCTION_APP_ID: 'app1',
  BASE44_MASTER_KEY: 'master',
  POSTMARK_SERVER_TOKEN: 'pm',
  ALERT_FROM_EMAIL: 'alerts@billtap.app',
};

const RATING = { id: 'r1', restaurant_id: 'rest1', stars: 2, comment: 'Cold food', guest_email: 'guest@example.com' };
const RESTAURANT = { id: 'rest1', name: 'Joe Diner', alert_email: 'owner@example.com' };

/**
 * Base44 over fetch, plus the outbound mail and SMS providers.
 *
 * `store` is mutable so a test can assert on what the endpoint wrote — the
 * alerted_at stamp is the only thing standing between an unauthenticated
 * endpoint and an unbounded phone bill, so whether it lands is the point.
 */
function stub({ rating = RATING, restaurant = RESTAURANT, emailOk = true, smsOk = true, updateOk = true } = {}) {
  const store = { rating: rating ? { ...rating } : null, restaurant };
  const sent = { emails: 0, sms: 0 };
  const original = globalThis.fetch;

  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = init.method || 'GET';

    if (u.includes('postmarkapp.com')) {
      sent.emails += 1;
      return new Response('{}', { status: emailOk ? 200 : 500 });
    }
    if (u.includes('twilio.com')) {
      sent.sms += 1;
      return new Response('{}', { status: smsOk ? 201 : 500 });
    }
    // A single-key id lookup goes to Base44's by-id endpoint, which answers
    // with the row itself rather than a list — see filter() in
    // worker/lib/base44.js. Returning an array here instead made every lookup
    // resolve to [[row]] and the endpoint report "Invalid rating", which looks
    // exactly like a real failure and is not one.
    if (u.includes('/entities/GuestRating')) {
      if (method === 'PUT' || method === 'PATCH') {
        if (!updateOk) return new Response('write refused', { status: 500 });
        Object.assign(store.rating, JSON.parse(init.body));
        return new Response(JSON.stringify(store.rating), { status: 200 });
      }
      if (!store.rating) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify(store.rating), { status: 200 });
    }
    if (u.includes('/entities/Restaurant')) {
      if (!store.restaurant) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify(store.restaurant), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  };

  return { store, sent, restore: () => { globalThis.fetch = original; } };
}

const fire = (env = ENV, body = { rating_id: 'r1' }) =>
  onRequestPost({
    request: new Request('https://billtap.app/api/rating-alert', { method: 'POST', body: JSON.stringify(body) }),
    env,
  });

async function withStub(opts, fn) {
  const s = stub(opts);
  try { return await fn(s); } finally { s.restore(); }
}

// ── The bug that made this file necessary ───────────────────────────────────

test('an operator actually gets paged', async () => {
  // The regression. Everything upstream healthy, every credential present, and
  // the endpoint still refused to send — because a helper referenced a variable
  // that was not in its scope and its own catch turned that into "refusing to
  // send". This asserts the outcome, not the mechanism, so any future version
  // of the same mistake fails here too.
  await withStub({}, async ({ sent, store }) => {
    const res = await fire();
    // Read once. A Response body cannot be consumed twice, and doing so inside
    // an assertion message throws over the top of the real failure.
    const out = await res.json();
    assert.equal(res.status, 200, JSON.stringify(out));
    assert.equal(out.notified, true);
    assert.equal(sent.emails, 1, 'no email left the Worker');
    assert.ok(store.rating.alerted_at, 'the alert was sent without being claimed — it can be replayed');
  });
});

// ── The claim, which is the only spend cap ──────────────────────────────────

test('the claim is written before anything is sent, not after', async () => {
  // Stamping afterwards leaves the whole send window open to a replay, and two
  // concurrent requests both read alerted_at as empty and both page.
  await withStub({ updateOk: false }, async ({ sent }) => {
    const res = await fire();
    assert.equal(res.status, 500);
    assert.equal(sent.emails, 0, 'it sent an alert it could not claim — that is the replay window');
  });
});

test('a rating already alerted is not alerted again', async () => {
  // This endpoint takes no credentials, because the guest firing it has no
  // account. Without the dedupe, one rating_id can be replayed for as long as
  // anyone cares to, and each replay is another email and another SMS.
  //
  // Both stamps, which is what a fully-alerted row looks like: RATING carries a
  // comment, so under the old flow that comment went out with the single alert.
  // Migration 0018 backfills exactly this shape for rows that predate it, so
  // that a historical alert cannot fire a duplicate carrying the same text.
  await withStub({ rating: { ...RATING, alerted_at: 1700000000000, comment_alerted_at: 1700000000000 } }, async ({ sent }) => {
    const res = await fire();
    assert.equal(res.status, 200);
    assert.equal((await res.json()).already_alerted, true);
    assert.equal(sent.emails, 0);
  });
});

test('a failed delivery releases the claim so a retry is possible', async () => {
  // The opposite failure: a permanently swallowed alert. If nothing reached the
  // operator, the stamp must come back off.
  await withStub({ emailOk: false, smsOk: false }, async ({ store }) => {
    const res = await fire();
    assert.equal(res.status, 502);
    assert.equal(store.rating.alerted_at, null, 'the alert is now unretryable and nobody was told');
  });
});

// ── Inputs ──────────────────────────────────────────────────────────────────

test('a missing rating id is refused', async () => {
  await withStub({}, async () => {
    assert.equal((await fire(ENV, {})).status, 400);
  });
});

test('a rating that does not exist is a 404, not a crash', async () => {
  await withStub({ rating: null }, async ({ sent }) => {
    assert.equal((await fire()).status, 404);
    assert.equal(sent.emails, 0);
  });
});

test('a restaurant with no alert contact is refused rather than half-sent', async () => {
  await withStub({ restaurant: { id: 'rest1', name: 'Joe Diner' } }, async ({ sent, store }) => {
    assert.equal((await fire()).status, 400);
    assert.equal(sent.emails, 0);
    assert.ok(!store.rating.alerted_at, 'a rating nobody could be paged about must stay retryable');
  });
});

test('an oversized body is refused before anything is parsed', async () => {
  await withStub({}, async () => {
    const res = await onRequestPost({
      request: new Request('https://billtap.app/api/rating-alert', {
        method: 'POST', body: JSON.stringify({ rating_id: 'r1', pad: 'x'.repeat(1024) }),
      }),
      env: ENV,
    });
    assert.equal(res.status, 413);
  });
});

// ── It has to survive the database moving ───────────────────────────────────

test('it reads through the data layer, so the cutover does not silence it', async () => {
  // It used to build Base44 URLs by hand with the master key. After
  // DATA_BACKEND=supabase that would read a database with nothing in it, and
  // because the caller never reads the response, the alerts would simply stop.
  const seen = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    seen.push(u);
    if (u.includes('/rest/v1/guest_ratings')) {
      if ((init.method || 'GET') !== 'GET') return new Response('[]', { status: 200 });
      return new Response(JSON.stringify([RATING]), { status: 200 });
    }
    if (u.includes('/rest/v1/restaurants')) return new Response(JSON.stringify([RESTAURANT]), { status: 200 });
    if (u.includes('postmarkapp.com')) return new Response('{}', { status: 200 });
    return new Response('{}', { status: 200 });
  };
  try {
    const res = await fire({
      ...ENV,
      DATA_BACKEND: 'supabase',
      SUPABASE_URL: 'https://p.supabase.co',
      PRODUCTION_SUPABASE_URL: 'https://p.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service',
    });
    const out = await res.json();
    assert.equal(res.status, 200, JSON.stringify(out));
    assert.ok(seen.some((u) => u.includes('supabase.co')), 'it did not follow DATA_BACKEND');
    assert.ok(!seen.some((u) => u.includes('base44')), 'it still talked to Base44 after the cutover');
  } finally {
    globalThis.fetch = original;
  }
});
