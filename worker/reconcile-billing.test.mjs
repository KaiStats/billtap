/**
 * The job that lets `plan` move backwards.
 *
 * Without it `plan` only ever moved forward: verify-checkout wrote 'active'
 * when a browser returned from Stripe Checkout, and nothing wrote anything
 * else, ever. A restaurant that cancelled stayed 'active' in this database
 * permanently — so the enforcement in shared/entitlement.js would have had
 * nothing truthful to enforce against.
 *
 * There is no webhook. This polls instead, which is the right shape at this
 * size: no public endpoint, no signature verification, and a night that fails
 * costs nothing because the next night asks the same question.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scheduled as reconcile } from './routes/reconcile-billing.js';

const ENV = {
  DATA_BACKEND: 'supabase',
  SUPABASE_URL: 'https://stub.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  STRIPE_SECRET_KEY: 'sk_test_123',
};

const SUBSCRIBED = () => ({
  id: 'r1', name: 'Mariposa', plan: 'active',
  stripe_subscription_id: 'sub_live_1',
  current_period_end: Date.UTC(2026, 7, 20),
});

/** Stubs Supabase and Stripe; `subs` maps subscription id to what Stripe says. */
function stub({ restaurants = [], subs = {}, stripeStatus = 200 } = {}) {
  const original = globalThis.fetch;
  const tables = { restaurants: structuredClone(restaurants), audit_log: [] };
  const asked = [];

  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (u.hostname === 'api.stripe.com') {
      const id = u.pathname.split('/').pop();
      asked.push(id);
      if (stripeStatus !== 200) return new Response(JSON.stringify({ error: {} }), { status: stripeStatus });
      return new Response(JSON.stringify(subs[id] || {}), { status: 200 });
    }
    const from = u.pathname.replace('/rest/v1/', '').split('?')[0];
    const rows = tables[from] || (tables[from] = []);
    const method = init.method || 'GET';
    if (method === 'PATCH') {
      const id = (u.searchParams.get('id') || '').replace('eq.', '');
      const hit = rows.filter((r) => String(r.id) === id);
      for (const r of hit) Object.assign(r, JSON.parse(init.body));
      return new Response(JSON.stringify(hit), { status: 200 });
    }
    if (method === 'POST') {
      rows.push(JSON.parse(init.body));
      return new Response(JSON.stringify([{}]), { status: 201 });
    }
    return new Response(JSON.stringify(rows), { status: 200 });
  };

  return { tables, asked, restore: () => { globalThis.fetch = original; } };
}

async function withStub(opts, fn) {
  const s = stub(opts);
  try { return await fn(s); } finally { s.restore(); }
}

test('a cancelled subscription stops being active here too', async () => {
  // The whole reason this job exists.
  await withStub({
    restaurants: [SUBSCRIBED()],
    subs: { sub_live_1: { status: 'canceled', current_period_end: 1780000000 } },
  }, async ({ tables }) => {
    const summary = await reconcile(ENV);
    assert.equal(tables.restaurants[0].plan, 'cancelled');
    assert.equal(summary.changed, 1);
  });
});

test('a failed card becomes past_due, which still serves during grace', async () => {
  await withStub({
    restaurants: [SUBSCRIBED()],
    subs: { sub_live_1: { status: 'past_due', current_period_end: 1780000000 } },
  }, async ({ tables }) => {
    await reconcile(ENV);
    assert.equal(tables.restaurants[0].plan, 'past_due');
  });
});

test('a healthy subscription has its period end moved forward', async () => {
  // What keeps a paying restaurant from ever reaching the staleness backstop.
  const renewed = Math.floor(Date.UTC(2026, 8, 20) / 1000);
  await withStub({
    restaurants: [SUBSCRIBED()],
    subs: { sub_live_1: { status: 'active', current_period_end: renewed } },
  }, async ({ tables }) => {
    await reconcile(ENV);
    assert.equal(tables.restaurants[0].current_period_end, renewed * 1000);
    assert.equal(tables.restaurants[0].plan, 'active');
  });
});

test('a Stripe trial counts as active — they handed over a card', async () => {
  await withStub({
    restaurants: [{ ...SUBSCRIBED(), plan: 'trial' }],
    subs: { sub_live_1: { status: 'trialing', current_period_end: 1790000000 } },
  }, async ({ tables }) => {
    await reconcile(ENV);
    assert.equal(tables.restaurants[0].plan, 'active');
  });
});

test('a restaurant with no subscription is never touched', async () => {
  // On trial, clock is trial_ends_at, Stripe has never heard of them.
  const onTrial = { id: 'r2', plan: 'trial', trial_ends_at: 1790000000000, stripe_subscription_id: null };
  await withStub({ restaurants: [onTrial] }, async ({ tables, asked }) => {
    const summary = await reconcile(ENV);
    assert.deepEqual(asked, [], 'no API call for a restaurant Stripe does not know');
    assert.equal(summary.checked, 0);
    assert.equal(tables.restaurants[0].plan, 'trial');
  });
});

test('an unknown Stripe status changes nothing', async () => {
  // `incomplete` is a checkout that never finished. Knocking a restaurant off
  // a trial it is legitimately on, because of a status this build has not been
  // taught, is exactly the wrong direction to guess in.
  await withStub({
    restaurants: [{ ...SUBSCRIBED(), plan: 'trial' }],
    subs: { sub_live_1: { status: 'incomplete' } },
  }, async ({ tables }) => {
    await reconcile(ENV);
    assert.equal(tables.restaurants[0].plan, 'trial');
  });
});

test('a Stripe error leaves the row alone and is reported, not thrown', async () => {
  // A 404 means the id in our column does not resolve. Cutting service over
  // that would be destroying a subscription because of our own bad data.
  await withStub({ restaurants: [SUBSCRIBED()], stripeStatus: 404 }, async ({ tables }) => {
    const summary = await reconcile(ENV);
    assert.equal(tables.restaurants[0].plan, 'active', 'untouched');
    assert.equal(summary.failures.length, 1);
    assert.equal(summary.failures[0].status, 404);
  });
});

test('one restaurant failing does not stop the others', async () => {
  const second = { ...SUBSCRIBED(), id: 'r2', stripe_subscription_id: 'sub_live_2' };
  await withStub({
    restaurants: [SUBSCRIBED(), second],
    subs: { sub_live_2: { status: 'canceled' } },  // sub_live_1 answers {}
  }, async ({ tables }) => {
    await reconcile(ENV);
    assert.equal(tables.restaurants.find((r) => r.id === 'r2').plan, 'cancelled');
  });
});

test('a plan change is audited; a period sliding forward is not', async () => {
  // "Why did our service stop" is a dispute. A renewal date advancing every
  // month is not, and a row per restaurant per month would bury the ones that
  // matter.
  await withStub({
    restaurants: [SUBSCRIBED()],
    subs: { sub_live_1: { status: 'canceled' } },
  }, async ({ tables }) => {
    await reconcile(ENV);
    assert.equal(tables.audit_log.length, 1);
    assert.equal(tables.audit_log[0].action, 'billing.reconciled');
  });

  const renewed = Math.floor(Date.UTC(2026, 8, 20) / 1000);
  await withStub({
    restaurants: [SUBSCRIBED()],
    subs: { sub_live_1: { status: 'active', current_period_end: renewed } },
  }, async ({ tables }) => {
    await reconcile(ENV);
    assert.deepEqual(tables.audit_log, [], 'a renewal is not a dispute');
  });
});

test('no Stripe key is a skip, not a failure', async () => {
  // A deployment where nobody has subscribed has nothing to reconcile.
  const summary = await reconcile({ ...ENV, STRIPE_SECRET_KEY: '' });
  assert.equal(summary.skipped, 'no_stripe_key');
});
