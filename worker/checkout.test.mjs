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
 * they have. And, since the 13-layer audit that found it: the fourth way, where
 * this route WROTE a plan change for a restaurant the caller does not operate,
 * because nothing here ever asked who the caller was. That is what most of the
 * new tests below guard.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost } from './routes/verify-checkout.js';

const ENV = {
  STRIPE_SECRET_KEY: 'sk_test_x',
  DATA_BACKEND: 'supabase',
  SUPABASE_URL: 'https://p.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  SUPABASE_ANON_KEY: 'anon',
};

const OWNER = { id: 'u1', email: 'owner@example.com' };

const request = (sessionId = 'cs_test_1', { auth = 'Bearer test-token' } = {}) =>
  new Request('https://billtap.app/api/verify-checkout', {
    method: 'POST',
    headers: auth ? { Authorization: auth } : {},
    body: JSON.stringify({ session_id: sessionId }),
  });

/**
 * Stands in for Stripe, Supabase Auth, and the Restaurant table, and records
 * the writes.
 *
 * `writes` is the point of it: everything below is about which row was patched
 * with what, and whether it was patched at all.
 *
 * `user` stands in for the caller's Supabase session — null means "no session
 * resolves", which is what an absent or invalid Authorization header, or a
 * signed-out caller, looks like from the route's side. `restaurantRow` stands
 * in for whatever the Restaurant table actually holds at the id Stripe names;
 * the ownership check reads it before writing.
 */
function stubNetwork(stripeSession, { user = OWNER, restaurantRow = { id: 'r1', owner_id: OWNER.id } } = {}) {
  const writes = [];
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    calls.push(href);
    if (href.startsWith('https://api.stripe.com/')) {
      return new Response(JSON.stringify(stripeSession), { status: 200 });
    }
    if (href.includes('/auth/v1/user')) {
      return user
        ? new Response(JSON.stringify(user), { status: 200 })
        : new Response(JSON.stringify({}), { status: 401 });
    }
    if (href.includes('supabase.co')) {
      const method = (init.method || 'GET').toUpperCase();
      if (method === 'PATCH') {
        writes.push({ url: href, body: JSON.parse(init.body || '{}') });
        return new Response(JSON.stringify([{ id: 'r1' }]), { status: 200 });
      }
      // The ownership-check read, keyed on id rather than owner_id.
      if (href.includes('id=eq.')) {
        return new Response(JSON.stringify(restaurantRow ? [restaurantRow] : []), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    }
    throw new Error(`unexpected fetch: ${href}`);
  };
  return { writes, calls, restore: () => { globalThis.fetch = original; } };
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
  //
  // The ownership-check read succeeds and finds the caller's own row — this
  // test is specifically about the write after that failing, not about the
  // lookup before it.
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    if (href.startsWith('https://api.stripe.com/')) {
      return new Response(JSON.stringify(PAID), { status: 200 });
    }
    if (href.includes('/auth/v1/user')) {
      return new Response(JSON.stringify(OWNER), { status: 200 });
    }
    if ((init.method || 'GET').toUpperCase() === 'PATCH') {
      return new Response('{"message":"nope"}', { status: 500 });
    }
    return new Response(JSON.stringify([{ id: 'r1', owner_id: OWNER.id }]), { status: 200 });
  };
  try {
    const res = await onRequestPost({ request: request(), env: ENV, ctx: null });
    // 500, not the 502 this used to hard-code for every failure in the try
    // block regardless of source: errorResponse's generic path for a
    // non-AppError throw is 500, and the frontend never reads res.status —
    // RestaurantDashboard.jsx only ever checks the parsed body's `paid`
    // field, so this is not a behaviour change a caller can observe.
    assert.equal(res.status, 500);
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

// ── Whose restaurant this actually is ───────────────────────────────────────
//
// The 13-layer audit's finding: this route trusted client_reference_id
// unconditionally, and until create-checkout was fixed that value came
// straight from a request body — so a caller could pay for their own
// subscription and have it activate a restaurant they do not operate,
// overwriting that restaurant's stripe_subscription_id and billing address.
// These tests are the regression guard, checked in both directions: a
// legitimate owner is unaffected, and a session naming someone else's
// restaurant writes nothing no matter how convincingly Stripe says it was paid.

test('an unauthenticated caller cannot verify a payment at all', async () => {
  const net = stubNetwork(PAID);
  try {
    const res = await onRequestPost({ request: request('cs_test_1', { auth: null }), env: ENV, ctx: null });
    assert.equal(res.status, 401);
    assert.equal(net.writes.length, 0, 'nothing should be written without a resolved caller');
    assert.ok(
      !net.calls.some((u) => u.startsWith('https://api.stripe.com/')),
      'Stripe should not even be asked when the caller cannot be identified',
    );
  } finally {
    net.restore();
  }
});

test('an invalid or expired session token cannot verify a payment', async () => {
  const net = stubNetwork(PAID, { user: null });
  try {
    const res = await onRequestPost({ request: request(), env: ENV, ctx: null });
    assert.equal(res.status, 401);
    assert.equal(net.writes.length, 0);
  } finally {
    net.restore();
  }
});

test('a session naming a restaurant the caller does not own writes nothing', async () => {
  // Stripe genuinely says paid=true here. That is exactly the case that
  // matters: money changed hands, and it still must not buy a plan change on
  // an account the payer does not operate.
  const net = stubNetwork(PAID, { restaurantRow: { id: 'r1', owner_id: 'someone-else' } });
  try {
    const res = await onRequestPost({ request: request(), env: ENV, ctx: null });
    const body = await res.json();
    assert.equal(net.writes.length, 0, 'the mismatched restaurant must not be touched');
    // Reported as unpaid to THIS caller, not as an error that leaks whether
    // r1 exists or who owns it — see verify-checkout.js's header comment for
    // why this is the honest answer from where the caller stands.
    assert.equal(body.paid, false);
    assert.equal(body.restaurant_id, null);
  } finally {
    net.restore();
  }
});

test('a restaurant id Stripe names that does not exist at all writes nothing', async () => {
  const net = stubNetwork(PAID, { restaurantRow: null });
  try {
    const res = await onRequestPost({ request: request(), env: ENV, ctx: null });
    assert.equal(net.writes.length, 0);
    assert.equal((await res.json()).paid, false);
  } finally {
    net.restore();
  }
});
