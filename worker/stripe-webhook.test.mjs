/**
 * Stripe telling us what happened — and everyone else being turned away.
 *
 * This endpoint takes no credentials and grants paid plans. Anyone who finds
 * the URL can POST to it, so the HMAC is not one control among several, it is
 * the only one. Most of what follows is about refusing things.
 *
 * The rest is about the gap it exists to close: verify-checkout only runs when
 * Stripe redirects a browser back, so a customer who closes the tab has paid
 * and been given nothing, and a renewal or a cancellation involves no browser
 * at all and could never have been seen.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost as webhook, verifyStripeSignature } from './routes/stripe-webhook.js';

const SECRET = 'whsec_test_secret_value';

const ENV = {
  DATA_BACKEND: 'supabase',
  SUPABASE_URL: 'https://stub.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  SUPABASE_ANON_KEY: 'anon-key',
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_WEBHOOK_SECRET: SECRET,
};

const enc = new TextEncoder();

/** Signs a payload the way Stripe does, so the tests exercise the real check. */
async function sign(body, secret = SECRET, timestamp = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${body}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `t=${timestamp},v1=${hex}`;
}

/** PostgREST plus the Stripe subscription read, recording what was written. */
function stub({ profiles = [], restaurants = [], subscription = null, stripeStatus = null } = {}) {
  const original = globalThis.fetch;
  const tables = { profiles: structuredClone(profiles), restaurants: structuredClone(restaurants) };

  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';

    if (u.hostname === 'api.stripe.com') {
      // A rate limit or an outage, as distinct from "no such subscription".
      if (stripeStatus) return new Response('{"error":"upstream"}', { status: stripeStatus });
      return subscription
        ? new Response(JSON.stringify(subscription), { status: 200 })
        : new Response(JSON.stringify({ error: 'no such subscription' }), { status: 404 });
    }

    const from = u.pathname.replace('/rest/v1/', '').split('?')[0];
    const rows = tables[from] || (tables[from] = []);
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
      const row = JSON.parse(init.body);
      rows.push(row);
      return new Response(JSON.stringify([row]), { status: 201 });
    }
    return new Response(JSON.stringify(rows.filter(match)), { status: 200 });
  };

  return { tables, restore: () => { globalThis.fetch = original; } };
}

async function withStub(opts, fn) {
  const s = stub(opts);
  try { return await fn(s); } finally { s.restore(); }
}

const deliver = async (event, { signature, env = ENV } = {}) => {
  const raw = JSON.stringify(event);
  const sig = signature === undefined ? await sign(raw) : signature;
  return webhook({
    env,
    request: new Request('https://billtap.app/api/stripe-webhook', {
      method: 'POST',
      headers: sig ? { 'stripe-signature': sig } : {},
      body: raw,
    }),
  });
};

const PRO_SUB = (over = {}) => ({
  id: 'sub_pro_1',
  object: 'subscription',
  status: 'active',
  customer: 'cus_1',
  current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
  metadata: { user_id: 'user_kai', kind: 'pro' },
  ...over,
});

// ── Everyone who is not Stripe ──────────────────────────────────────────────

test('an unsigned request is refused', async () => {
  const res = await deliver({ type: 'customer.subscription.updated', data: { object: PRO_SUB() } }, { signature: null });
  assert.equal(res.status, 400);
});

test('a forged signature is refused', async () => {
  const res = await deliver(
    { type: 'customer.subscription.updated', data: { object: PRO_SUB() } },
    { signature: `t=${Math.floor(Date.now() / 1000)},v1=${'a'.repeat(64)}` },
  );
  assert.equal(res.status, 400);
});

test('a signature from the wrong secret is refused', async () => {
  const raw = JSON.stringify({ type: 'customer.subscription.updated', data: { object: PRO_SUB() } });
  const res = await deliver(
    { type: 'customer.subscription.updated', data: { object: PRO_SUB() } },
    { signature: await sign(raw, 'whsec_someone_elses_secret') },
  );
  assert.equal(res.status, 400);
});

test('a replayed delivery from last week is refused', async () => {
  // The timestamp is inside the signed payload, so it cannot be edited. What
  // this stops is a genuine, correctly signed event captured and posted again.
  const body = JSON.stringify({ type: 'customer.subscription.updated', data: { object: PRO_SUB() } });
  const old = Math.floor(Date.now() / 1000) - 7 * 86400;
  const res = await deliver(
    { type: 'customer.subscription.updated', data: { object: PRO_SUB() } },
    { signature: await sign(body, SECRET, old) },
  );
  assert.equal(res.status, 400);
});

test('a tampered body fails even with a real signature attached', async () => {
  // Signature over one payload, delivered with another — the shape of somebody
  // replaying a real event with the amount or the user id changed.
  const honest = JSON.stringify({ type: 'customer.subscription.updated', data: { object: PRO_SUB() } });
  const sig = await sign(honest);
  const res = await webhook({
    env: ENV,
    request: new Request('https://billtap.app/api/stripe-webhook', {
      method: 'POST',
      headers: { 'stripe-signature': sig },
      body: JSON.stringify({ type: 'customer.subscription.updated', data: { object: PRO_SUB({ metadata: { user_id: 'somebody_else', kind: 'pro' } }) } }),
    }),
  });
  assert.equal(res.status, 400);
});

test('an unconfigured secret refuses everything rather than trusting anything', async () => {
  // The failure that would matter most: a deploy without the binding must not
  // become an endpoint that grants Pro to whoever finds the URL.
  const res = await deliver(
    { type: 'customer.subscription.updated', data: { object: PRO_SUB() } },
    { env: { ...ENV, STRIPE_WEBHOOK_SECRET: undefined } },
  );
  assert.equal(res.status, 503);
});

test('the signature check accepts more than one v1 during a rotation', async () => {
  // Stripe sends both the old and new signature while a secret is being
  // rotated. Checking only the first would break every delivery for the length
  // of the rotation — a billing outage at the worst possible moment.
  const body = '{"a":1}';
  const real = await sign(body);
  const [t, v1] = real.split(',');
  const header = `${t},v1=${'b'.repeat(64)},${v1}`;
  assert.equal((await verifyStripeSignature(body, header, SECRET)).ok, true);
});

// ── Consumer Pro ────────────────────────────────────────────────────────────

test('a completed checkout grants Pro to the user in the metadata', async () => {
  await withStub({ subscription: PRO_SUB() }, async ({ tables }) => {
    const res = await deliver({
      type: 'checkout.session.completed',
      data: { object: { client_reference_id: 'user_kai', subscription: 'sub_pro_1' } },
    });
    assert.equal(res.status, 200);
    const row = tables.profiles[0];
    assert.equal(row.id, 'user_kai');
    assert.equal(row.plan, 'pro');
    assert.equal(row.stripe_subscription_id, 'sub_pro_1');
    assert.ok(row.plan_expires_at > Date.now(), 'paid up until the period end');
  });
});

test('this is what makes closing the tab survivable', async () => {
  /**
   * The whole reason this route exists. verify-checkout only runs when Stripe
   * redirects a browser back, so somebody who pays and closes the tab has
   * bought something and been given nothing. No browser is involved here at
   * all — the event arrives from Stripe's servers.
   */
  await withStub({ subscription: PRO_SUB() }, async ({ tables }) => {
    await deliver({
      type: 'checkout.session.completed',
      data: { object: { client_reference_id: 'user_kai', subscription: 'sub_pro_1' } },
    });
    assert.equal(tables.profiles[0].plan, 'pro', 'provisioned without the browser ever coming back');
  });
});

test('a trialing subscription is Pro, because that is what a trial is', async () => {
  await withStub({ subscription: PRO_SUB({ status: 'trialing' }) }, async ({ tables }) => {
    await deliver({ type: 'customer.subscription.updated', data: { object: PRO_SUB({ status: 'trialing' }) } });
    assert.equal(tables.profiles[0].plan, 'pro');
  });
});

test('a cancellation takes effect when the paid period runs out, not on the spot', async () => {
  /**
   * Migration 0017's stated design, which the code did not implement: "nobody
   * is cut off mid-month and nobody keeps Pro forever: they run to the end of
   * what they paid for." resolvePartyLimit reads plan_expires_at only from
   * inside `if (plan === 'pro')`, so writing 'free' here skipped the expiry
   * entirely and took the month back off somebody who had paid for it.
   */
  const existing = [{ id: 'user_kai', plan: 'pro', stripe_subscription_id: 'sub_pro_1' }];
  await withStub({ profiles: existing }, async ({ tables }) => {
    await deliver({
      type: 'customer.subscription.deleted',
      data: { object: PRO_SUB({ status: 'canceled' }) },
    });
    assert.equal(tables.profiles[0].plan, 'pro', 'through to the end of the period');
    assert.ok(tables.profiles[0].plan_expires_at > Date.now(), 'and the expiry is what ends it');
  });
});

test('a cancellation with nothing left to run drops to free immediately', async () => {
  // The other half of the same rule. cancel_at_period_end means the deleted
  // event arrives *at* the period end, so this is the ordinary case — and a
  // trial abandoned on day one has no paid period to honour at all.
  const existing = [{ id: 'user_kai', plan: 'pro', stripe_subscription_id: 'sub_pro_1' }];
  await withStub({ profiles: existing }, async ({ tables }) => {
    await deliver({
      type: 'customer.subscription.deleted',
      data: { object: PRO_SUB({
        status: 'canceled',
        current_period_end: Math.floor(Date.now() / 1000) - 60,
      }) },
    });
    assert.equal(tables.profiles[0].plan, 'free');
  });
});

test('the same event twice lands on the same row state', async () => {
  // Stripe delivers at least once, not exactly once, and retries on any
  // non-2xx. Every write here is a set-to-a-value rather than an append, so a
  // redelivery is a no-op rather than a second subscription.
  await withStub({ subscription: PRO_SUB() }, async ({ tables }) => {
    const event = {
      type: 'checkout.session.completed',
      data: { object: { client_reference_id: 'user_kai', subscription: 'sub_pro_1' } },
    };
    await deliver(event);
    await deliver(event);
    assert.equal(tables.profiles.length, 1, 'one row, not two');
    assert.equal(tables.profiles[0].plan, 'pro');
  });
});

// ── Restaurants, on the same pipe ───────────────────────────────────────────

test('a restaurant subscription is applied to the restaurant row', async () => {
  // The $149 product had the same close-the-tab gap and no webhook at all. One
  // endpoint covers both rather than two that drift.
  const sub = PRO_SUB({ id: 'sub_rest_1', metadata: { restaurant_id: 'r_1', kind: 'restaurant' } });
  await withStub({ restaurants: [{ id: 'r_1', plan: 'trial' }], subscription: sub }, async ({ tables }) => {
    await deliver({ type: 'customer.subscription.updated', data: { object: sub } });
    assert.equal(tables.restaurants[0].plan, 'active');
    assert.equal(tables.restaurants[0].stripe_subscription_id, 'sub_rest_1');
  });
});

test('a cancelled restaurant is cancelled, not left active', async () => {
  const sub = PRO_SUB({ id: 'sub_rest_1', status: 'canceled', metadata: { restaurant_id: 'r_1' } });
  await withStub({ restaurants: [{ id: 'r_1', plan: 'active' }] }, async ({ tables }) => {
    await deliver({ type: 'customer.subscription.deleted', data: { object: sub } });
    assert.equal(tables.restaurants[0].plan, 'cancelled');
  });
});

// ── Everything else in the Stripe account ───────────────────────────────────

test('a paid subscription we cannot match to an account raises an alarm', async () => {
  /**
   * The failure this was written for, found the hard way.
   *
   * A live $0.99 Pro subscription was bought through a Stripe Payment Link.
   * Payment Links attach none of the metadata create-pro-checkout sets, so
   * subjectOf matched nothing — correctly, because guessing would award a paid
   * plan to whichever row happened to be nearest. The event was then dropped in
   * silence: money taken, nothing provisioned, and no record anywhere to notice
   * it by. It surfaced only by reading the Stripe dashboard against an empty
   * profiles table.
   *
   * Still a 200, because Stripe must stop retrying. But no longer silent.
   */
  const orphan = {
    id: 'sub_link_1',
    object: 'subscription',
    status: 'active',
    customer: 'cus_link_1',
    current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
    metadata: {},
  };
  // Captured rather than passed in: this route calls the audit helper directly,
  // so a callback on the event object would be quietly ignored — and a test
  // asserting on an argument nobody reads is worse than no test at all.
  const logged = [];
  const realError = console.error;
  console.error = (...args) => { logged.push(args.join(' ')); };
  try {
    await withStub({ subscription: orphan }, async ({ tables }) => {
      const res = await deliver({ type: 'customer.subscription.created', data: { object: orphan } });
      assert.equal(res.status, 200, 'Stripe must not retry an event nothing can act on');
      assert.equal((await res.json()).reason, 'no_subject');
      assert.equal(tables.profiles.length, 0, 'and nothing is provisioned on a guess');
    });
  } finally { console.error = realError; }

  const alarm = logged.find((line) => line.includes('paid_subscription_not_matched_to_an_account'));
  assert.ok(alarm, `the unmatched subscription was dropped in silence again:\n${logged.join('\n')}`);
  assert.match(alarm, /sub_link_1/, 'the alarm must name the subscription, or it cannot be found in Stripe');
  assert.match(alarm, /cus_link_1/, 'and the customer, which is how you reach the person who paid');
});

test('an ordinary unrelated event does not cry wolf', async () => {
  // Another product in the same Stripe account is genuinely uninteresting, and
  // an alarm on every one of those is how a real orphaned subscription gets
  // scrolled past.
  const logged = [];
  const realError = console.error;
  console.error = (...args) => { logged.push(args.join(' ')); };
  try {
    await withStub({ subscription: null }, async () => {
      await deliver({ type: 'invoice.paid', data: { object: { subscription: null } } });
    });
  } finally { console.error = realError; }
  assert.equal(logged.filter((l) => l.includes('paid_subscription_not_matched')).length, 0);
});

test('an event about somebody else is acknowledged and ignored', async () => {
  // A subscription created by hand in the dashboard, or another product in the
  // same account. A 200 stops Stripe retrying something nothing here will act
  // on; guessing which row it meant would be worse than doing nothing.
  const orphan = PRO_SUB({ metadata: {} });
  await withStub({}, async ({ tables }) => {
    const res = await deliver({ type: 'customer.subscription.updated', data: { object: orphan } });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).reason, 'no_subject');
    assert.equal(tables.profiles.length, 0, 'and nothing was written on a guess');
  });
});

test('an event type we do not handle is acknowledged, not retried forever', async () => {
  const res = await deliver({ type: 'payout.paid', data: { object: {} } });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ignored, 'payout.paid');
});

test('a write that fails answers 500 so Stripe tries again', async () => {
  /**
   * The one place in this app where failing loudly is right. Stripe redelivers
   * on a non-2xx with backoff for days; answering 200 to an event that could
   * not be applied loses a payment somebody has already made, silently, with
   * no second chance.
   */
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (new URL(url).hostname === 'api.stripe.com') {
      return new Response(JSON.stringify(PRO_SUB()), { status: 200 });
    }
    throw new Error('database is down');
  };
  try {
    const res = await deliver({
      type: 'checkout.session.completed',
      data: { object: { client_reference_id: 'user_kai', subscription: 'sub_pro_1' } },
    });
    assert.equal(res.status, 500, 'so it comes back');
  } finally { globalThis.fetch = original; }
});


// ── The grace period, and the events that used to vanish ────────────────────

test('a card that just failed does not cancel the restaurant on the spot', async () => {
  /**
   * The bug this pins was worth $149 a month, per restaurant, per failed card.
   *
   * entitlement.js gives a past_due plan GRACE_DAYS before it stops working,
   * and reconcile-billing maps Stripe's past_due onto exactly that. This route
   * had its own rule — active or trialing, else 'cancelled' — and it runs
   * within seconds of invoice.payment_failed, so it always got there first. The
   * grace period was written, tested, and unreachable.
   */
  await withStub({
    restaurants: [{ id: 'r1', plan: 'active' }],
    subscription: {
      id: 'sub_r1', object: 'subscription', status: 'past_due', customer: 'cus_r',
      current_period_end: Math.floor(Date.now() / 1000) + 86400,
      metadata: { restaurant_id: 'r1' },
    },
  }, async (s) => {
    const res = await deliver({ type: 'invoice.payment_failed', data: { object: { subscription: 'sub_r1' } } });
    assert.equal(res.status, 200);
    assert.equal(s.tables.restaurants[0].plan, 'past_due',
      'past_due, so the seven-day grace in entitlement.js can still apply');
  });
});

test('a Pro subscriber in retry keeps Pro until the period they paid for ends', async () => {
  // plan_expires_at is what ends it — resolvePartyLimit already refuses a pro
  // plan whose expiry has passed. Writing 'free' here took it away mid-retry.
  await withStub({
    profiles: [{ id: 'user_kai', plan: 'pro' }],
    subscription: PRO_SUB({ status: 'past_due' }),
  }, async (s) => {
    await deliver({ type: 'customer.subscription.updated', data: { object: PRO_SUB({ status: 'past_due' }) } });
    assert.equal(s.tables.profiles[0].plan, 'pro');
    assert.ok(s.tables.profiles[0].plan_expires_at > Date.now(), 'and the expiry is what will end it');
  });
});

test('an incomplete checkout does not knock a trial off its plan', async () => {
  await withStub({
    restaurants: [{ id: 'r1', plan: 'trial' }],
    subscription: {
      id: 'sub_r1', object: 'subscription', status: 'incomplete',
      metadata: { restaurant_id: 'r1' },
    },
  }, async (s) => {
    const res = await deliver({ type: 'customer.subscription.updated', data: { object: {
      id: 'sub_r1', object: 'subscription', status: 'incomplete', metadata: { restaurant_id: 'r1' },
    } } });
    assert.equal(res.status, 200);
    assert.equal(s.tables.restaurants[0].plan, 'trial', 'left exactly as it was');
  });
});

test('Stripe failing to answer makes us retry, not forget a payment somebody made', async () => {
  /**
   * The worst of the lot, because it was silent and it was final.
   *
   * readSubscription returned null on every non-2xx, and null reached the
   * `no_subject` branch, which answers 200 — so Stripe never redelivered. One
   * rate limit on a paid checkout.session.completed and that customer's
   * subscription was charged and never provisioned, with nothing anywhere that
   * would notice: the nightly reconciler walks Restaurant rows and has never
   * read `profiles` at all.
   */
  await withStub({ profiles: [], stripeStatus: 500 }, async (s) => {
    const res = await deliver({
      type: 'checkout.session.completed',
      data: { object: { subscription: 'sub_pro_1', client_reference_id: 'user_kai' } },
    });
    assert.equal(res.status, 500, 'a non-2xx is what makes Stripe try again');
    assert.equal(s.tables.profiles.length, 0, 'and nothing half-written in the meantime');
  });
});

test('a subscription that really is not ours is still acknowledged', async () => {
  // The 404 case must keep its old behaviour: retrying will never make a
  // subscription from another Stripe account appear.
  await withStub({ subscription: null }, async () => {
    const res = await deliver({
      type: 'checkout.session.completed',
      data: { object: { subscription: 'sub_gone', client_reference_id: null } },
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).reason, 'no_subject');
  });
});
