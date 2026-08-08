/**
 * Starting a Stripe Checkout session for a restaurant's subscription.
 *
 * Until the 13-layer audit found it, this endpoint took `restaurant_id`
 * straight out of the request body with no check that the caller operates
 * that restaurant — client_reference_id carried the value into Stripe, and
 * verify-checkout later wrote plan: "active" onto whatever row that id named.
 * Anyone who paid could attach the result to a restaurant they do not own,
 * overwriting its stripe_subscription_id and billing address.
 *
 * The fix removes the id parameter rather than checking it, the same way
 * saveMyRestaurant answers the same question: the row is found from the
 * signed-in caller's own identity via findOrAdoptRestaurant, so there is
 * nothing in the body left to tamper with. Every test below that sends a
 * `restaurant_id` unrelated to the caller's own is the regression guard —
 * checking that the value is not merely validated but never consulted at all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost } from './routes/create-checkout.js';

const ENV = {
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_PRICE_ID: 'price_149',
  DATA_BACKEND: 'supabase',
  SUPABASE_URL: 'https://p.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  SUPABASE_ANON_KEY: 'anon',
};

const OWNER = { id: 'u1', email: 'owner@example.com' };
const OWNED_RESTAURANT = { id: 'r1', owner_id: OWNER.id, name: "Owner's Place" };

const request = (bodyOverrides = {}, { auth = 'Bearer test-token' } = {}) =>
  new Request('https://billtap.app/api/create-checkout', {
    method: 'POST',
    headers: auth ? { Authorization: auth } : {},
    body: JSON.stringify({ restaurant_id: OWNED_RESTAURANT.id, email: OWNER.email, ...bodyOverrides }),
  });

/**
 * Stands in for Stripe and Supabase, and records what was actually sent to
 * Stripe — `client_reference_id` above all, since that is the field the whole
 * vulnerability turned on.
 *
 * `owned` is the row findOrAdoptRestaurant's first lookup (owner_id=eq.) would
 * find; null means the caller has none, which exercises the orphan-adoption
 * branch (an alert_email match) and, failing that, "no restaurant at all".
 */
function stubNetwork({ user = OWNER, owned = OWNED_RESTAURANT, stripeStatus = 200, stripeBody = null } = {}) {
  const stripeCalls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    if (href.startsWith('https://api.stripe.com/')) {
      const params = new URLSearchParams(init.body);
      stripeCalls.push({ href, params });
      return new Response(
        JSON.stringify(stripeBody ?? { id: 'cs_new_1', url: 'https://checkout.stripe.com/cs_new_1' }),
        { status: stripeStatus },
      );
    }
    if (href.includes('/auth/v1/user')) {
      return user
        ? new Response(JSON.stringify(user), { status: 200 })
        : new Response(JSON.stringify({}), { status: 401 });
    }
    if (href.includes('supabase.co')) {
      if (href.includes('owner_id=eq.')) {
        return new Response(JSON.stringify(owned ? [owned] : []), { status: 200 });
      }
      // The orphan-by-email lookup, and everything else this test does not
      // otherwise care about: no unclaimed row to adopt.
      return new Response('[]', { status: 200 });
    }
    throw new Error(`unexpected fetch: ${href}`);
  };
  return { stripeCalls, restore: () => { globalThis.fetch = original; } };
}

test('starts checkout for the caller\'s own restaurant', async () => {
  const net = stubNetwork();
  try {
    const res = await onRequestPost({ request: request(), env: ENV, ctx: null, requestId: 'req1' });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.url, 'https://checkout.stripe.com/cs_new_1');
    assert.equal(net.stripeCalls.length, 1);
    assert.equal(net.stripeCalls[0].params.get('client_reference_id'), OWNED_RESTAURANT.id);
    assert.equal(
      net.stripeCalls[0].params.get('subscription_data[metadata][restaurant_id]'),
      OWNED_RESTAURANT.id,
    );
  } finally {
    net.restore();
  }
});

test('a restaurant_id in the body naming someone else is never sent to Stripe', async () => {
  // The regression guard. The body claims a completely different restaurant;
  // the session opened must still be for the caller's own.
  const net = stubNetwork();
  try {
    await onRequestPost({
      request: request({ restaurant_id: 'someone-elses-restaurant' }),
      env: ENV, ctx: null, requestId: 'req1',
    });
    assert.equal(net.stripeCalls.length, 1);
    assert.equal(
      net.stripeCalls[0].params.get('client_reference_id'),
      OWNED_RESTAURANT.id,
      'the body-supplied id must be ignored entirely, not merely rejected',
    );
    assert.notEqual(net.stripeCalls[0].params.get('client_reference_id'), 'someone-elses-restaurant');
  } finally {
    net.restore();
  }
});

test('an unauthenticated caller cannot start checkout for anything', async () => {
  const net = stubNetwork();
  try {
    const res = await onRequestPost({ request: request({}, { auth: null }), env: ENV, ctx: null, requestId: 'req1' });
    assert.equal(res.status, 401);
    assert.equal(net.stripeCalls.length, 0, 'Stripe must never be reached for an unresolved caller');
  } finally {
    net.restore();
  }
});

test('an invalid session token cannot start checkout', async () => {
  const net = stubNetwork({ user: null });
  try {
    const res = await onRequestPost({ request: request(), env: ENV, ctx: null, requestId: 'req1' });
    assert.equal(res.status, 401);
    assert.equal(net.stripeCalls.length, 0);
  } finally {
    net.restore();
  }
});

test('a signed-in caller with no restaurant of their own cannot start checkout', async () => {
  const net = stubNetwork({ owned: null });
  try {
    const res = await onRequestPost({ request: request(), env: ENV, ctx: null, requestId: 'req1' });
    assert.equal(res.status, 404);
    assert.equal(net.stripeCalls.length, 0);
  } finally {
    net.restore();
  }
});

test('billing not configured yet is reported without reaching Stripe', async () => {
  const net = stubNetwork();
  try {
    const res = await onRequestPost({
      request: request(), env: { ...ENV, STRIPE_PRICE_ID: undefined }, ctx: null, requestId: 'req1',
    });
    assert.equal(res.status, 503);
    assert.equal(net.stripeCalls.length, 0);
  } finally {
    net.restore();
  }
});

test('a rejected Stripe session is reported as a failure to start checkout', async () => {
  const net = stubNetwork({ stripeStatus: 400, stripeBody: { error: { message: 'bad price id' } } });
  try {
    const res = await onRequestPost({ request: request(), env: ENV, ctx: null, requestId: 'req1' });
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.url, undefined);
  } finally {
    net.restore();
  }
});

test('malformed JSON is rejected before any lookup', async () => {
  const net = stubNetwork();
  try {
    const req = new Request('https://billtap.app/api/create-checkout', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token' },
      body: '{not json',
    });
    const res = await onRequestPost({ request: req, env: ENV, ctx: null, requestId: 'req1' });
    assert.equal(res.status, 400);
    assert.equal(net.stripeCalls.length, 0);
  } finally {
    net.restore();
  }
});
