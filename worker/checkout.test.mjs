/**
 * Turning a Stripe payment into an active plan.
 *
 * This used to be two halves in two places: the Worker asked Stripe whether the
 * session was paid, and the browser then wrote plan: "active" onto its own
 * Restaurant row through the Base44 SDK. A client that could write the row did
 * not really have to ask, so the verification was a correctness boundary rather
 * than a security one.
 *
 * Both halves are here now. What is worth pinning is not that the happy path
 * works — it is the three ways a paying customer ends up looking at a dashboard
 * that says they have not paid, or a non-paying one at a dashboard that says
 * they have.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { onRequestPost } from './routes/verify-checkout.js';

const ENV = {
  STRIPE_SECRET_KEY: 'sk_test_x',
  DATA_BACKEND: 'supabase',
  SUPABASE_URL: 'https://p.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  SUPABASE_ANON_KEY: 'anon',
};

const request = (sessionId = 'cs_test_1') =>
  new Request('https://billtap.app/api/verify-checkout', {
    method: 'POST',
    // The bearer the browser attaches. Without it the route cannot tell whose
    // restaurant this is, and correctly refuses to activate anything.
    headers: { Authorization: 'Bearer token' },
    body: JSON.stringify({ session_id: sessionId }),
  });

/**
 * Stands in for both Stripe and Supabase, and records the writes.
 *
 * `writes` is the point of it: everything below is about which row was patched
 * with what, and whether it was patched at all.
 */
/** The signed-in operator these tests act as, and the row they own. */
const CALLER = { id: 'user_owner', email: 'owner@example.com' };

function stubNetwork(stripeSession) {
  const writes = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    if (href.startsWith('https://api.stripe.com/')) {
      return new Response(JSON.stringify(stripeSession), { status: 200 });
    }
    if (href.includes('supabase.co')) {
      const method = (init.method || 'GET').toUpperCase();
      /**
       * Auth and ownership, which this fixture predates.
       *
       * verify-checkout now refuses to activate a row the caller does not own —
       * create-checkout used to take restaurant_id straight from the request
       * body, so a paid `cs_` id can name somebody else's restaurant, and
       * writing the plan onto it would overwrite their stripe_subscription_id.
       * See worker/checkout-ownership.test.mjs for that case in full.
       *
       * These tests are about what a *legitimate* payment writes, so the caller
       * owns r1 and the interesting assertions below are unchanged.
       */
      if (href.includes('/auth/v1/user')) {
        return new Response(JSON.stringify(CALLER), { status: 200 });
      }
      if (method === 'PATCH') {
        writes.push({ url: href, body: JSON.parse(init.body || '{}') });
        return new Response(JSON.stringify([{ id: 'r1' }]), { status: 200 });
      }
      if (href.includes('/rest/v1/restaurants')) {
        return new Response(JSON.stringify([{ id: 'r1', owner_id: CALLER.id }]), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    }
    throw new Error(`unexpected fetch: ${href}`);
  };
  return { writes, restore: () => { globalThis.fetch = original; } };
}

const PAID = {
  payment_status: 'paid',
  status: 'complete',
  client_reference_id: 'r1',
  subscription: { id: 'sub_1', current_period_end: 1800000000 },
  customer: { address: { line1: '1 Main St', city: 'Vegas', state: 'nv', postal_code: '89101', country: 'us' } },
};

test('a paid session activates the plan without the browser being asked to', async () => {
  const net = stubNetwork(PAID);
  try {
    const res = await onRequestPost({ request: request(), env: ENV, ctx: null });
    const body = await res.json();
    assert.equal(body.paid, true);

    assert.equal(net.writes.length, 1, 'the plan must be written server-side');
    assert.equal(net.writes[0].body.plan, 'active');
    assert.equal(net.writes[0].body.stripe_subscription_id, 'sub_1');
    // Epoch milliseconds, not Stripe's seconds. Everything else in this schema
    // that holds a time holds milliseconds, and a thousand-fold error here reads
    // as a subscription that ended in 1970.
    assert.equal(net.writes[0].body.current_period_end, 1800000000 * 1000);
  } finally {
    net.restore();
  }
});

test('an unpaid session writes nothing at all', async () => {
  // The direction that costs money rather than trust: a checkout that was
  // abandoned must not leave an active plan behind it.
  const net = stubNetwork({ ...PAID, payment_status: 'unpaid', status: 'open' });
  try {
    const res = await onRequestPost({ request: request(), env: ENV, ctx: null });
    assert.equal((await res.json()).paid, false);
    assert.equal(net.writes.length, 0);
  } finally {
    net.restore();
  }
});

test('a paid session Stripe cannot tie to a restaurant writes nothing', async () => {
  // client_reference_id is set when the Checkout session is created. Without it
  // there is no row to activate, and guessing at one would activate somebody
  // else's.
  const net = stubNetwork({ ...PAID, client_reference_id: null });
  try {
    await onRequestPost({ request: request(), env: ENV, ctx: null });
    assert.equal(net.writes.length, 0);
  } finally {
    net.restore();
  }
});

test('a failed write is reported as a failure to verify', async () => {
  // Answering ok while the row still says trial leaves somebody who has been
  // charged looking at a dashboard that says they have not paid — and nothing
  // retries, because as far as the browser is concerned it succeeded.
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).startsWith('https://api.stripe.com/')) {
      return new Response(JSON.stringify(PAID), { status: 200 });
    }
    return new Response('{"message":"nope"}', { status: 500 });
  };
  try {
    const res = await onRequestPost({ request: request(), env: ENV, ctx: null });
    assert.equal(res.status, 502);
    assert.equal((await res.json()).paid, undefined);
  } finally {
    globalThis.fetch = original;
  }
});

test('the billing address is stored in the same shape it is returned in', async () => {
  // Sales tax nexus is measured per state, so the state is the field that
  // matters and it is compared against a two-letter code. Stored lowercase from
  // Stripe, it matches nothing.
  const net = stubNetwork(PAID);
  try {
    const res = await onRequestPost({ request: request(), env: ENV, ctx: null });
    const body = await res.json();
    assert.equal(body.billing_address.state, 'NV');
    assert.equal(body.billing_address.country, 'US');
    assert.deepEqual(net.writes[0].body.billing_address, body.billing_address);
  } finally {
    net.restore();
  }
});

test('an address with no state does not blank one already on file', async () => {
  // A partial read from Stripe is a normal event. Writing the empty object over
  // a good address loses the only record of where a customer is.
  const net = stubNetwork({ ...PAID, customer: { address: { line1: '1 Main St', country: 'us' } } });
  try {
    await onRequestPost({ request: request(), env: ENV, ctx: null });
    assert.ok(!('billing_address' in net.writes[0].body));
  } finally {
    net.restore();
  }
});

test('checkout does not send customer_update without a customer', async () => {
  /**
   * Stripe answers this combination with a 400:
   *
   *   `customer_update` can only be used with `customer`.
   *
   * customer_update describes how to update an *existing* customer, and this
   * route never passes one — it hands over customer_email and lets Checkout
   * create the customer. So every restaurant checkout 400'd from the moment
   * that line was added, and the route answered "Could not start checkout"
   * without anyone reading the body that said why.
   *
   * Nothing was lost by removing it: in subscription mode Stripe saves the
   * collected address onto the customer it creates.
   */
  const src = readFileSync(new URL('./routes/create-checkout.js', import.meta.url), 'utf8');
  const sent = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/customer_update/.test(sent),
    'customer_update is back, and Stripe will 400 every checkout while it is');
  assert.match(sent, /billing_address_collection/,
    'the address is still collected — nexus depends on it');
});
