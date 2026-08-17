/**
 * Selling Pro to somebody who already has it.
 *
 * The route's own header explains why it authenticates where create-checkout
 * does not: consumer Pro attaches to a person, so "who is this for" has to come
 * from a verified session. That was right and it was not enough — it established
 * *who* without ever asking *what they already have*.
 *
 * The consequence was not a validation error. It was a second Stripe Customer
 * on the same card, a second subscription the database then stopped pointing
 * at, and a second fourteen-day trial — all reachable by a subscriber tapping a
 * live button on the pricing card they had every reason to think was for them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost } from './routes/create-pro-checkout.js';

const ENV = {
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_PRO_PRICE_ID: 'price_pro',
  DATA_BACKEND: 'supabase',
  SUPABASE_URL: 'https://p.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  SUPABASE_ANON_KEY: 'anon',
  PUBLIC_BASE_URL: 'https://billtap.app',
};

const USER = { id: 'user_kai', email: 'kai@example.com' };

/**
 * Stands in for Supabase auth, the profiles read, and Stripe.
 *
 * `sent` is the point of it — every assertion below is about which parameters
 * reached Checkout.
 */
function stub({ profile = null, stripeStatus = 200 } = {}) {
  const original = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    if (href.includes('/auth/v1/user')) {
      return new Response(JSON.stringify(USER), { status: 200 });
    }
    if (href.includes('/rest/v1/profiles')) {
      return new Response(JSON.stringify(profile ? [profile] : []), { status: 200 });
    }
    if (href.startsWith('https://api.stripe.com/')) {
      sent.push(new URLSearchParams(String(init.body)));
      return new Response(JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/cs_1' }), { status: stripeStatus });
    }
    throw new Error(`unexpected fetch: ${href}`);
  };
  return { sent, restore: () => { globalThis.fetch = original; } };
}

const post = (body = {}, env = ENV) => onRequestPost({
  env,
  request: new Request('https://billtap.app/api/create-pro-checkout', {
    method: 'POST',
    headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }),
});

async function withStub(opts, fn) {
  const s = stub(opts);
  try { return await fn(s); } finally { s.restore(); }
}

test('a first-time subscriber gets the trial and a new customer', async () => {
  await withStub({ profile: null }, async ({ sent }) => {
    const res = await post();
    assert.equal(res.status, 200);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].get('subscription_data[trial_period_days]'), '14');
    assert.equal(sent[0].get('customer_email'), 'kai@example.com');
    assert.equal(sent[0].get('customer'), null, 'there is no customer to reuse yet');
  });
});

test('somebody already on Pro is refused rather than sold a second subscription', async () => {
  /**
   * The whole bug in one sequence: subscribe in January, land on the home page
   * in February, do not remember, tap Get Pro. The idempotency key is bucketed
   * by the hour, so it offered no resistance at all a month later — Stripe made
   * a second customer and a second subscription on the same card, and the
   * webhook then pointed the row at the new one. The January subscription was
   * left referenced by nothing: charged monthly, forever, and not reachable
   * from any screen, route or reconcile job here.
   */
  const profile = {
    id: 'user_kai',
    plan: 'pro',
    plan_expires_at: Date.now() + 20 * 86400000,
    stripe_customer_id: 'cus_1',
    stripe_subscription_id: 'sub_A',
  };
  await withStub({ profile }, async ({ sent }) => {
    const res = await post();
    assert.equal(res.status, 409);
    assert.equal((await res.json()).code, 'already_pro');
    assert.equal(sent.length, 0, 'Stripe was never asked for a second session');
  });
});

test('a lapsed subscriber may buy again, on their existing customer', async () => {
  // Coming back is welcome. Reusing the Stripe customer is what keeps the old
  // subscription visible and cancellable instead of orphaning it.
  const profile = {
    id: 'user_kai',
    plan: 'free',
    plan_expires_at: Date.now() - 86400000,
    stripe_customer_id: 'cus_1',
  };
  await withStub({ profile }, async ({ sent }) => {
    assert.equal((await post()).status, 200);
    assert.equal(sent[0].get('customer'), 'cus_1');
    assert.equal(sent[0].get('customer_email'), null, 'the customer carries the address');
  });
});

test('the free trial is once per person, not once per checkout', async () => {
  /**
   * Cancel on day thirteen, resubscribe on day fifteen, another fourteen free
   * days — and because each checkout minted a fresh Stripe Customer, Stripe's
   * own customer-level trial tracking could not deduplicate them either. Repeat
   * monthly and the unlimited party size is permanent and free.
   */
  const profile = { id: 'user_kai', plan: 'free', stripe_customer_id: 'cus_1' };
  await withStub({ profile }, async ({ sent }) => {
    await post();
    assert.equal(sent[0].get('subscription_data[trial_period_days]'), null,
      'they have been through checkout before');
  });
});

test('an expired Pro row does not block a renewal', async () => {
  // plan stays 'pro' with plan_expires_at doing the cutting off, so "already on
  // Pro" has to mean a *live* plan or a lapsed subscriber could never return.
  const profile = { id: 'user_kai', plan: 'pro', plan_expires_at: Date.now() - 1000 };
  await withStub({ profile }, async ({ sent }) => {
    assert.equal((await post()).status, 200);
    assert.equal(sent.length, 1);
  });
});

test('a profile read that fails still lets somebody buy Pro', async () => {
  // Deliberate direction: the read only ever narrows what this route will do,
  // and refusing to take money because one SELECT timed out is worse than the
  // duplicate it prevents.
  const original = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    if (href.includes('/auth/v1/user')) return new Response(JSON.stringify(USER), { status: 200 });
    if (href.includes('/rest/v1/profiles')) return new Response('{"message":"timeout"}', { status: 500 });
    sent.push(new URLSearchParams(String(init.body)));
    return new Response(JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/cs_1' }), { status: 200 });
  };
  try {
    assert.equal((await post()).status, 200);
    assert.equal(sent.length, 1);
  } finally { globalThis.fetch = original; }
});

test('an anonymous caller is refused before anything is read', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/auth/v1/user')) return new Response('{}', { status: 401 });
    throw new Error('nothing else should be reached');
  };
  try {
    const res = await onRequestPost({
      env: ENV,
      request: new Request('https://billtap.app/api/create-pro-checkout', { method: 'POST', body: '{}' }),
    });
    assert.equal(res.status, 401);
  } finally { globalThis.fetch = original; }
});

// ── Annual, a distinct Stripe price gated on its own binding ─────────────────

const ANNUAL_ENV = { ...ENV, STRIPE_PRO_ANNUAL_PRICE_ID: 'price_pro_annual' };

test('a monthly checkout uses the monthly price', async () => {
  await withStub({ profile: null }, async ({ sent }) => {
    await post({ plan: 'monthly' });
    assert.equal(sent[0].get('line_items[0][price]'), 'price_pro');
  });
});

test('an annual checkout uses the annual price when it is configured', async () => {
  await withStub({ profile: null }, async ({ sent }) => {
    const res = await post({ plan: 'annual' }, ANNUAL_ENV);
    assert.equal(res.status, 200);
    assert.equal(sent[0].get('line_items[0][price]'), 'price_pro_annual');
    // Still once-per-person trial and the same user metadata — nothing about
    // the interval changes who it is for or the webhook that provisions it.
    assert.equal(sent[0].get('subscription_data[metadata][user_id]'), 'user_kai');
    assert.equal(sent[0].get('subscription_data[trial_period_days]'), '14');
  });
});

test('asking for annual before its price exists is a clean refusal, not a silent monthly charge', async () => {
  // The substitution worth refusing: someone clicks $29/yr and is quietly put
  // on $3.99/mo instead. ENV has no annual price, so this must not fall back.
  await withStub({ profile: null }, async ({ sent }) => {
    const res = await post({ plan: 'annual' }, ENV);
    assert.equal(res.status, 503);
    assert.equal((await res.json()).code, 'not_configured');
    assert.equal(sent.length, 0, 'no monthly session may be minted for an annual request');
  });
});

test('an unknown interval is treated as monthly, never as an error', async () => {
  // 'annual' or nothing else. A garbage value can only undersell.
  await withStub({ profile: null }, async ({ sent }) => {
    await post({ plan: 'quarterly' });
    assert.equal(sent[0].get('line_items[0][price]'), 'price_pro');
  });
});

test('switching monthly to annual is not blocked as a duplicate', async () => {
  // The idempotency key includes the interval, so a person who tried monthly
  // and then chose yearly in the same hour is two distinct intents, not a
  // double-tap to be swallowed.
  await withStub({ profile: null }, async ({ sent }) => {
    await post({ plan: 'monthly' });
    await post({ plan: 'annual' }, ANNUAL_ENV);
    assert.equal(sent.length, 2);
  });
});
