/**
 * getMyPlan — the read the running-tab screen decides what to draw from.
 *
 * It has to agree with resolvePartyLimit, because the server enforces the party
 * cap from the same Profile row. A screen that shows Pro while the server denies
 * it hands somebody a paid view and then a 403; a screen that hides it from a
 * paying subscriber is a bug they are paying to not have. So the cases that
 * matter are the boundaries: expired, hand-granted (no expiry), and the failure
 * that must fall to free rather than throw.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HANDLERS } from './routes/functions.js';

const ENV = {
  DATA_BACKEND: 'supabase',
  SUPABASE_URL: 'https://stub.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  SUPABASE_ANON_KEY: 'anon-key',
};

const USER = { id: 'user_kai', email: 'kai@example.com' };
const DAY = 86400000;

function stub({ profiles = [], signedIn = true, profileStatus = 200 } = {}) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    if (u.pathname.includes('/auth/v1/user')) {
      return signedIn
        ? new Response(JSON.stringify(USER), { status: 200 })
        : new Response('{}', { status: 401 });
    }
    if (u.pathname.includes('/rest/v1/profiles')) {
      if (profileStatus !== 200) return new Response('{"message":"boom"}', { status: profileStatus });
      const id = (u.searchParams.get('id') || '').replace('eq.', '');
      return new Response(JSON.stringify(profiles.filter((p) => !id || p.id === id)), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${u.href}`);
  };
  return () => { globalThis.fetch = original; };
}

const call = () => HANDLERS.getMyPlan({
  env: ENV,
  request: new Request('https://billtap.app/api/fn/getMyPlan', {
    method: 'POST',
    headers: { Authorization: 'Bearer t' },
  }),
});

async function withStub(opts, fn) {
  const restore = stub(opts);
  try { return await fn(); } finally { restore(); }
}

test('an anonymous caller is free, not an error', async () => {
  // The screen asks this on load, before anyone has signed in. "no" is the
  // honest answer; a 401 would be a broken home screen.
  await withStub({ signedIn: false }, async () => {
    const body = await (await call()).json();
    assert.equal(body.pro, false);
    assert.equal(body.plan, 'free');
  });
});

test('a live Pro subscription reads as Pro', async () => {
  await withStub({ profiles: [{ id: 'user_kai', plan: 'pro', plan_expires_at: Date.now() + 20 * DAY }] }, async () => {
    const body = await (await call()).json();
    assert.equal(body.pro, true);
    assert.equal(body.plan, 'pro');
  });
});

test('an expired Pro plan reads as free — the clock is the authority', async () => {
  // Same rule resolvePartyLimit applies: plan_expires_at in the past means the
  // cap is back, so the tab must not still be shown as unlocked.
  await withStub({ profiles: [{ id: 'user_kai', plan: 'pro', plan_expires_at: Date.now() - DAY }] }, async () => {
    const body = await (await call()).json();
    assert.equal(body.pro, false);
    assert.equal(body.plan, 'free');
  });
});

test('a hand-granted plan with no expiry is Pro forever', async () => {
  // Migration 0017: a null expiry is a plan granted by hand, meant not to end.
  await withStub({ profiles: [{ id: 'user_kai', plan: 'pro', plan_expires_at: null }] }, async () => {
    assert.equal((await (await call()).json()).pro, true);
  });
});

test('a free profile reads as free', async () => {
  await withStub({ profiles: [{ id: 'user_kai', plan: 'free' }] }, async () => {
    assert.equal((await (await call()).json()).pro, false);
  });
});

test('no profile row yet reads as free', async () => {
  await withStub({ profiles: [] }, async () => {
    assert.equal((await (await call()).json()).pro, false);
  });
});

test('a profile read that fails falls to free, and does not throw', async () => {
  // The safe direction: a Pro user briefly not shown their tab, never a free
  // user handed it — and the server still refuses the cap regardless.
  await withStub({ profileStatus: 500 }, async () => {
    const res = await call();
    assert.equal(res.status, 200);
    assert.equal((await res.json()).pro, false);
  });
});

// ── getBillingConfig: what the pricing card is allowed to offer ─────────────

const billingConfig = (env) => HANDLERS.getBillingConfig({
  env,
  request: new Request('https://billtap.app/api/fn/getBillingConfig', { method: 'POST' }),
});

test('annual is offered only when its Stripe price is bound', async () => {
  const off = await (await billingConfig({ ...ENV })).json();
  assert.equal(off.annual_available, false, 'no price, no yearly toggle');

  const on = await (await billingConfig({ ...ENV, STRIPE_PRO_ANNUAL_PRICE_ID: 'price_year' })).json();
  assert.equal(on.annual_available, true);
});

test('the config never leaks the price id itself', async () => {
  // A boolean about our pricing is public; the id is not, and the client has no
  // use for it.
  const body = await (await billingConfig({ ...ENV, STRIPE_PRO_ANNUAL_PRICE_ID: 'price_secret' })).json();
  assert.equal(JSON.stringify(body).includes('price_secret'), false);
});
