/**
 * Deleting an operator's account.
 *
 * Until the 13-layer audit found it, src/pages/Profile.jsx had called this
 * since before a handler for it existed — every real attempt 404'd as
 * unknown_function. Safe (nothing was ever half-deleted) but not what "type
 * DELETE and confirm" promised anyone.
 *
 * What is worth pinning here is the scope, because it is deliberately
 * narrower than "erase everything": the Restaurant row, its ratings and its
 * audit history survive with owner_id cleared, because compliance/ exists —
 * this app tracks economic nexus from the customer list, and tax records
 * outlive the account that generated them. Only the Supabase Auth user and
 * the ability to sign in are actually deleted.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HANDLERS } from './routes/functions.js';
import { ACTIONS } from './lib/audit.js';

const OWNER = { id: 'user_owner', email: 'owner@example.com' };
const ENV = {
  DATA_BACKEND: 'supabase',
  SUPABASE_URL: 'https://stub.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  SUPABASE_ANON_KEY: 'anon-key',
  STRIPE_SECRET_KEY: 'sk_test_x',
};

/**
 * Stands in for Supabase Auth, the restaurants table, Stripe, and the
 * Supabase Admin API — and records every call made to the latter three,
 * since what matters here is which side effects fired and in what order.
 */
function stub({ user = OWNER, restaurants = [] } = {}) {
  const original = globalThis.fetch;
  const rows = structuredClone(restaurants);
  const calls = { stripeCancel: [], adminDelete: [], patches: [] };

  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    const method = (init.method || 'GET').toUpperCase();

    if (href.includes('/auth/v1/admin/users/')) {
      calls.adminDelete.push({ href, method });
      return new Response('{}', { status: 200 });
    }
    if (href.includes('/auth/v1/user')) {
      return user
        ? new Response(JSON.stringify(user), { status: 200 })
        : new Response(JSON.stringify({ error: 'bad jwt' }), { status: 401 });
    }
    if (href.startsWith('https://api.stripe.com/v1/subscriptions/')) {
      calls.stripeCancel.push({ href, method });
      return new Response('{}', { status: 200 });
    }
    if (href.includes('/restaurants')) {
      const u = new URL(href);
      if (method === 'PATCH') {
        const idParam = u.searchParams.get('id');
        const id = idParam ? idParam.replace(/^eq\./, '') : null;
        const patch = JSON.parse(init.body || '{}');
        calls.patches.push({ id, patch });
        const hit = rows.find((r) => r.id === id);
        if (hit) Object.assign(hit, patch);
        return new Response(JSON.stringify(hit ? [hit] : []), { status: 200 });
      }
      const ownerParam = u.searchParams.get('owner_id');
      const owner = ownerParam ? ownerParam.replace(/^eq\./, '') : null;
      const out = owner ? rows.filter((r) => r.owner_id === owner) : rows;
      return new Response(JSON.stringify(out), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${href}`);
  };

  return { rows, calls, restore: () => { globalThis.fetch = original; } };
}

const request = (auth = 'Bearer operator-token') =>
  new Request('https://billtap.app/api/fn/deleteAccount', {
    method: 'POST',
    headers: auth ? { Authorization: auth } : {},
  });

const RESTAURANT = (overrides = {}) => ({
  id: 'r_mariposa',
  name: 'Mariposa',
  owner_id: OWNER.id,
  stripe_subscription_id: null,
  ...overrides,
});

test('deletes the auth user and detaches (not deletes) the owned restaurant', async () => {
  const s = stub({ restaurants: [RESTAURANT({ stripe_subscription_id: 'sub_live_1' })] });
  const audited = [];
  try {
    const res = await HANDLERS.deleteAccount({
      env: ENV, request: request(), audit: async (entry) => audited.push(entry),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });

    assert.equal(s.calls.adminDelete.length, 1, 'the Supabase Auth user must be deleted');
    assert.equal(s.calls.adminDelete[0].href, 'https://stub.supabase.co/auth/v1/admin/users/user_owner');
    assert.equal(s.calls.adminDelete[0].method, 'DELETE');

    assert.equal(s.calls.stripeCancel.length, 1, 'an active subscription must be cancelled');
    assert.ok(s.calls.stripeCancel[0].href.includes('sub_live_1'));
    assert.equal(s.calls.stripeCancel[0].method, 'DELETE');

    // Detached, not deleted: the row still exists in the stub with its data
    // intact, only owner_id changed.
    assert.equal(s.rows.length, 1, 'the restaurant row must not be deleted');
    assert.equal(s.rows[0].owner_id, null);
    assert.equal(s.rows[0].name, 'Mariposa', 'its data must survive for compliance');

    assert.equal(audited.length, 1);
    assert.equal(audited[0].action, ACTIONS.ACCOUNT_DELETED);
    assert.equal(audited[0].actorUserId, OWNER.id);
    assert.equal(audited[0].detail.restaurants_detached, 1);
  } finally {
    s.restore();
  }
});

test('a caller with no restaurant still has their account deleted', async () => {
  const s = stub({ restaurants: [] });
  try {
    const res = await HANDLERS.deleteAccount({ env: ENV, request: request(), audit: async () => {} });
    assert.equal(res.status, 200);
    assert.equal(s.calls.adminDelete.length, 1);
    assert.equal(s.calls.stripeCancel.length, 0);
  } finally {
    s.restore();
  }
});

test('a restaurant with no Stripe subscription is detached without calling Stripe', async () => {
  const s = stub({ restaurants: [RESTAURANT()] });
  try {
    await HANDLERS.deleteAccount({ env: ENV, request: request(), audit: async () => {} });
    assert.equal(s.calls.stripeCancel.length, 0);
    assert.equal(s.rows[0].owner_id, null);
  } finally {
    s.restore();
  }
});

test('an unauthenticated caller deletes nothing', async () => {
  const s = stub({ restaurants: [RESTAURANT({ stripe_subscription_id: 'sub_live_1' })] });
  try {
    const res = await HANDLERS.deleteAccount({ env: ENV, request: request(null), audit: async () => {} });
    assert.equal(res.status, 401);
    assert.equal(s.calls.adminDelete.length, 0);
    assert.equal(s.calls.stripeCancel.length, 0);
    assert.equal(s.rows[0].owner_id, OWNER.id, 'ownership must be untouched');
  } finally {
    s.restore();
  }
});

test('a non-Supabase backend refuses rather than deleting the wrong thing', async () => {
  const s = stub({ restaurants: [RESTAURANT()] });
  try {
    await assert.rejects(
      () => HANDLERS.deleteAccount({ env: { ...ENV, DATA_BACKEND: 'base44' }, request: request(), audit: async () => {} }),
      (err) => err.code === 'not_supported' && err.status === 501,
    );
    // Checked before auth, so this must be refused even with no Authorization
    // header at all — reaching the auth lookup is itself the thing this
    // ordering avoids for an operation base44 cannot perform.
    await assert.rejects(
      () => HANDLERS.deleteAccount({ env: { ...ENV, DATA_BACKEND: 'base44' }, request: request(null), audit: async () => {} }),
      (err) => err.code === 'not_supported',
    );
    assert.equal(s.calls.adminDelete.length, 0);
  } finally {
    s.restore();
  }
});

test('Stripe cancellation failing does not block detaching the restaurant or deleting the account', async () => {
  const s = stub({ restaurants: [RESTAURANT({ stripe_subscription_id: 'sub_live_1' })] });
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).startsWith('https://api.stripe.com/')) throw new Error('network down');
    return original(url, init);
  };
  try {
    const res = await HANDLERS.deleteAccount({ env: ENV, request: request(), audit: async () => {} });
    assert.equal(res.status, 200, 'a Stripe failure must not fail the whole deletion');
    assert.equal(s.rows[0].owner_id, null);
    assert.equal(s.calls.adminDelete.length, 1);
  } finally {
    globalThis.fetch = original;
    s.restore();
  }
});

test('a failed auth-user deletion is reported, after the reversible steps already happened', async () => {
  const s = stub({ restaurants: [RESTAURANT({ stripe_subscription_id: 'sub_live_1' })] });
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('/auth/v1/admin/users/')) return new Response('{}', { status: 500 });
    return original(url, init);
  };
  try {
    await assert.rejects(
      () => HANDLERS.deleteAccount({ env: ENV, request: request(), audit: async () => {} }),
    );
    // The irreversible call failed, but everything before it already ran —
    // the restaurant was still detached and the subscription still
    // cancelled, so retrying deleteAccount does not double-charge or
    // re-detach anything that is already done.
    assert.equal(s.rows[0].owner_id, null);
    assert.equal(s.calls.stripeCancel.length, 1);
  } finally {
    globalThis.fetch = original;
    s.restore();
  }
});

test('multiple owned restaurants are all detached', async () => {
  const s = stub({
    restaurants: [
      RESTAURANT({ id: 'r_1', stripe_subscription_id: 'sub_1' }),
      RESTAURANT({ id: 'r_2', stripe_subscription_id: null }),
    ],
  });
  const audited = [];
  try {
    await HANDLERS.deleteAccount({ env: ENV, request: request(), audit: async (e) => audited.push(e) });
    assert.ok(s.rows.every((r) => r.owner_id === null));
    assert.equal(s.calls.stripeCancel.length, 1);
    assert.equal(audited[0].detail.restaurants_detached, 2);
  } finally {
    s.restore();
  }
});
