/**
 * Paying for a restaurant that is not yours.
 *
 * create-checkout took restaurant_id straight from the request body with no
 * authentication at all, and verify-checkout writes the resulting plan onto
 * whatever Stripe's client_reference_id names. The route's own header called
 * that merely loose — "the worst a stranger can do is pay for somebody else's
 * subscription" — and that reading was wrong, because the write does not only
 * set `plan`. It overwrites stripe_subscription_id and billing_address too.
 *
 * So: find a restaurant id, which is in URLs and API responses; start a
 * checkout naming it; pay the $149. That restaurant's row now points at your
 * subscription, theirs is orphaned and still billing them, and cancelling yours
 * makes the webhook write `cancelled` onto their row and take their QR codes
 * off the tables. $149 to cut a competitor off and leave them paying for it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost as createCheckout } from './routes/create-checkout.js';
import { onRequestPost as verifyCheckout } from './routes/verify-checkout.js';

const ENV = {
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_PRICE_ID: 'price_149',
  DATA_BACKEND: 'supabase',
  SUPABASE_URL: 'https://p.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  SUPABASE_ANON_KEY: 'anon',
};

const OWNER = { id: 'user_owner', email: 'owner@example.com' };
const ATTACKER = { id: 'user_attacker', email: 'attacker@example.com' };

/** Supabase auth, the restaurants table, and Stripe. `writes` is the point. */
function stub({ user = OWNER, restaurants = [], stripeSession = null } = {}) {
  const original = globalThis.fetch;
  const writes = [];
  const sent = [];

  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.pathname === '/auth/v1/user') {
      return user ? new Response(JSON.stringify(user), { status: 200 })
                  : new Response('{}', { status: 401 });
    }
    if (u.hostname === 'api.stripe.com') {
      if ((init.method || 'GET').toUpperCase() === 'POST') {
        sent.push(new URLSearchParams(String(init.body)));
        return new Response(JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/cs_1' }), { status: 200 });
      }
      return new Response(JSON.stringify(stripeSession || {}), { status: 200 });
    }
    const method = (init.method || 'GET').toUpperCase();
    if (method === 'PATCH') {
      writes.push({ url: u.pathname + u.search, body: JSON.parse(init.body || '{}') });
      return new Response('[{"id":"r"}]', { status: 200 });
    }
    const id = (u.searchParams.get('id') || '').replace('eq.', '');
    return new Response(JSON.stringify(restaurants.filter((r) => !id || r.id === id)), { status: 200 });
  };
  return { writes, sent, restore: () => { globalThis.fetch = original; } };
}

async function withStub(opts, fn) {
  const s = stub(opts);
  try { return await fn(s); } finally { s.restore(); }
}

const startCheckout = (restaurantId) => createCheckout({
  env: ENV,
  request: new Request('https://billtap.app/api/create-checkout', {
    method: 'POST',
    headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
    body: JSON.stringify({ restaurant_id: restaurantId, email: 'x@example.com' }),
  }),
});

const HERB = { id: 'r_herb', owner_id: 'user_owner' };

test('an owner can start a checkout for their own restaurant', async () => {
  await withStub({ user: OWNER, restaurants: [HERB] }, async ({ sent }) => {
    const res = await startCheckout('r_herb');
    assert.equal(res.status, 200);
    assert.equal(sent.length, 1, 'Stripe was never asked for a session');
  });
});

test('a stranger cannot start a checkout naming somebody else’s restaurant', async () => {
  await withStub({ user: ATTACKER, restaurants: [HERB] }, async ({ sent }) => {
    const res = await startCheckout('r_herb');
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, 'not_yours');
    assert.equal(sent.length, 0, 'no Stripe session may be minted for a restaurant you do not own');
  });
});

test('an anonymous caller cannot start one at all', async () => {
  await withStub({ user: null, restaurants: [HERB] }, async ({ sent }) => {
    assert.equal((await startCheckout('r_herb')).status, 401);
    assert.equal(sent.length, 0);
  });
});

test('a restaurant that does not exist refuses the same way as one you do not own', async () => {
  // Same shape on purpose — telling a stranger which ids exist is its own leak.
  await withStub({ user: ATTACKER, restaurants: [] }, async () => {
    const res = await startCheckout('r_guess');
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, 'not_yours');
  });
});

// ── The half that closing the front door cannot fix ─────────────────────────

const PAID_FOR_HERB = {
  payment_status: 'paid',
  status: 'complete',
  client_reference_id: 'r_herb',
  subscription: { id: 'sub_attacker', current_period_end: 1800000000 },
  customer: { address: { line1: '1 Main St', state: 'nv', country: 'us', city: 'Vegas', postal_code: '89101' } },
};

const verify = () => verifyCheckout({
  env: ENV,
  request: new Request('https://billtap.app/api/verify-checkout', {
    method: 'POST',
    headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: 'cs_test_1' }),
  }),
  ctx: null,
});

test('a paid session minted by the old code still cannot activate somebody else’s row', async () => {
  /**
   * The reason this check exists in two places. A `cs_` id created before the
   * front door was locked remains valid and completable for 24 hours, so
   * refusing new ones does nothing for one already in flight.
   */
  await withStub({ user: ATTACKER, restaurants: [HERB], stripeSession: PAID_FOR_HERB }, async ({ writes }) => {
    const res = await verify();
    const body = await res.json();
    assert.equal(body.paid, false, 'as far as the attacker’s own account is concerned, nothing changed');
    assert.equal(body.code, 'not_yours');
    assert.equal(writes.length, 0, 'the victim’s stripe_subscription_id must not be overwritten');
  });
});

test('the real owner completing the same session is activated normally', async () => {
  await withStub({ user: OWNER, restaurants: [HERB], stripeSession: PAID_FOR_HERB }, async ({ writes }) => {
    const body = await (await verify()).json();
    assert.equal(body.paid, true);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].body.plan, 'active');
    assert.equal(writes[0].body.stripe_subscription_id, 'sub_attacker');
  });
});
