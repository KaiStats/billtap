/**
 * Erasing a person, and the four ways that goes wrong quietly.
 *
 * src/pages/Privacy.jsx promises every visitor they may "delete their account
 * and all associated data at any time from the app's profile settings". The
 * button existed, the handler never did, and the request 404'd for the life of
 * the feature. So what is pinned here is not that the happy path runs — it is
 * the cases where somebody is told their data is gone and it is not, or where
 * honouring the request would take a paying business off the air.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost } from './routes/delete-account.js';

const USER = { id: 'user_kai', email: 'kai@example.com' };

const ENV = {
  DATA_BACKEND: 'supabase',
  SUPABASE_URL: 'https://p.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  SUPABASE_ANON_KEY: 'anon',
  STRIPE_SECRET_KEY: 'sk_test_x',
};

const post = (body = { confirm: 'DELETE' }, env = ENV) => onRequestPost({
  env,
  request: new Request('https://billtap.app/api/delete-account', {
    method: 'POST',
    headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }),
});

/**
 * Supabase, its auth admin API and Stripe.
 *
 * `calls` is the point: every assertion below is about which row was removed,
 * which was merely detached, and which was left exactly where it was.
 */
function stub({ restaurants = [], profiles = [], authStatus = 200, signedIn = true,
                stripeCustomers = [], stripeSubs = [], restaurantsMidDelete = null } = {}) {
  const original = globalThis.fetch;
  const tables = { restaurants: structuredClone(restaurants), profiles: structuredClone(profiles) };
  const calls = [];
  let restaurantReads = 0;

  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = (init.method || 'GET').toUpperCase();

    if (u.pathname.startsWith('/auth/v1/admin/users/')) {
      calls.push({ kind: 'auth_delete', method, id: u.pathname.split('/').pop() });
      return new Response('{}', { status: authStatus });
    }
    if (u.pathname === '/auth/v1/user') {
      return signedIn ? new Response(JSON.stringify(USER), { status: 200 }) : new Response('{}', { status: 401 });
    }
    if (u.hostname === 'api.stripe.com') {
      // Model the three shapes the route uses: list customers by email, list a
      // customer's subscriptions, and cancel one.
      if (method === 'GET' && u.pathname === '/v1/customers') {
        const email = u.searchParams.get('email');
        calls.push({ kind: 'stripe_list_customers', email });
        return new Response(JSON.stringify({ data: stripeCustomers.filter((c) => c.email === email) }), { status: 200 });
      }
      if (method === 'GET' && u.pathname === '/v1/subscriptions') {
        const customer = u.searchParams.get('customer');
        calls.push({ kind: 'stripe_list_subs', customer });
        return new Response(JSON.stringify({ data: stripeSubs.filter((s) => s.customer === customer) }), { status: 200 });
      }
      if (method === 'DELETE' && u.pathname.startsWith('/v1/subscriptions/')) {
        calls.push({ kind: 'stripe_cancel', method, id: decodeURIComponent(u.pathname.split('/').pop()) });
        return new Response('{"status":"canceled"}', { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }

    const from = u.pathname.replace('/rest/v1/', '');
    // Lets a test change what "SELECT owner_id restaurants" returns on the
    // SECOND read (the mid-deletion re-check) to model a concurrent acquisition.
    if (from === 'restaurants' && method === 'GET') {
      restaurantReads += 1;
      if (restaurantReads === 2 && restaurantsMidDelete) {
        return new Response(JSON.stringify(restaurantsMidDelete), { status: 200 });
      }
    }
    const rows = tables[from] || (tables[from] = []);
    const match = (row) => [...u.searchParams].every(([k, v]) => {
      if (['select', 'order', 'limit', 'offset'].includes(k)) return true;
      if (!String(v).startsWith('eq.')) return true;
      return String(row[k]) === String(v).slice(3);
    });

    if (method === 'DELETE') {
      const hit = rows.filter(match);
      tables[from] = rows.filter((r) => !hit.includes(r));
      calls.push({ kind: 'delete', table: from, count: hit.length });
      return new Response(JSON.stringify(hit), { status: 200 });
    }
    if (method === 'PATCH') {
      const hit = rows.filter(match);
      for (const row of hit) Object.assign(row, JSON.parse(init.body || '{}'));
      calls.push({ kind: 'patch', table: from, count: hit.length, body: JSON.parse(init.body || '{}') });
      return new Response(JSON.stringify(hit), { status: 200 });
    }
    return new Response(JSON.stringify(rows.filter(match)), { status: 200 });
  };

  return { tables, calls, restore: () => { globalThis.fetch = original; } };
}

async function withStub(opts, fn) {
  const s = stub(opts);
  try { return await fn(s); } finally { s.restore(); }
}

const authDeleted = (s) => s.calls.some((c) => c.kind === 'auth_delete');

test('an anonymous caller cannot delete anybody', async () => {
  await withStub({ signedIn: false }, async (s) => {
    assert.equal((await post()).status, 401);
    assert.equal(authDeleted(s), false);
  });
});

test('an unconfirmed request deletes nothing', async () => {
  // The screen makes them type DELETE. Checked again here, because an endpoint
  // that erases a person on an empty POST is one stray fetch from doing it.
  await withStub({}, async (s) => {
    const res = await post({});
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, 'not_confirmed');
    assert.equal(authDeleted(s), false);
  });
});

test('somebody who owns a restaurant is turned away with its name', async () => {
  /**
   * Deleting the row would take a paying business off the air mid-service and
   * strand every table tent already printed. Nulling owner_id is worse:
   * findOrAdoptRestaurant documents that a null owner makes a row *adoptable*,
   * so orphaning one hands a stranger a business's ratings and alert address.
   *
   * Neither is a defensible reading of "delete my account", so nothing happens
   * and the person is told exactly what to wind down first.
   */
  await withStub({
    restaurants: [{ id: 'r1', owner_id: 'user_kai', name: 'Herb & Rye', slug: 'herb-rye', plan: 'active', demo: false }],
  }, async (s) => {
    const res = await post();
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, 'owns_restaurant');
    assert.equal(body.restaurants[0].name, 'Herb & Rye', 'the name, because "you own a restaurant" is not actionable');

    assert.equal(authDeleted(s), false, 'and the account is untouched');
    assert.equal(s.tables.restaurants.length, 1, 'the business is still there');
  });
});

test('the account really is gone, not merely reported gone', async () => {
  await withStub({ profiles: [{ id: 'user_kai', stripe_subscription_id: 'sub_1' }] }, async (s) => {
    const res = await post();
    assert.equal(res.status, 200);
    assert.equal((await res.json()).deleted, true);

    assert.ok(authDeleted(s), 'the auth user must be deleted or they can still sign in');
    assert.equal(s.tables.profiles.length, 0, 'and the profile row with it');
  });
});

test('the subscription recorded on the row is cancelled before the account goes', async () => {
  // Otherwise it bills on against an account nothing in this app can reach —
  // the same orphan a Payment Link once created here, but self-inflicted.
  await withStub({ profiles: [{ id: 'user_kai', stripe_subscription_id: 'sub_1' }] }, async (s) => {
    await post();
    const cancel = s.calls.find((c) => c.kind === 'stripe_cancel');
    assert.ok(cancel, 'the subscription was left running');
    assert.equal(cancel.id, 'sub_1');
  });
});

test('a subscription the webhook has not recorded yet is still cancelled, via Stripe', async () => {
  /**
   * The confirmed audit finding. A Pro checkout paid seconds ago has a live
   * Stripe subscription, but its checkout.session.completed has not landed, so
   * profile.stripe_subscription_id is still null. Cancelling only the recorded
   * id would cancel nothing and bill the deleted user forever. Asking Stripe by
   * the customer's email finds it anyway.
   */
  await withStub({
    profiles: [{ id: 'user_kai', stripe_subscription_id: null, stripe_customer_id: null }],
    stripeCustomers: [{ id: 'cus_race', email: USER.email }],
    stripeSubs: [{ id: 'sub_inflight', customer: 'cus_race', status: 'active' }],
  }, async (s) => {
    await post();
    const cancels = s.calls.filter((c) => c.kind === 'stripe_cancel').map((c) => c.id);
    assert.ok(cancels.includes('sub_inflight'), `the in-flight subscription was orphaned: cancelled ${JSON.stringify(cancels)}`);
    assert.ok(s.calls.some((c) => c.kind === 'stripe_list_customers' && c.email === USER.email),
      'Stripe must be asked by email, not just trusted from the row');
  });
});

test('a canceled subscription is not re-cancelled, only live ones', async () => {
  await withStub({
    profiles: [{ id: 'user_kai', stripe_customer_id: 'cus_1' }],
    stripeCustomers: [{ id: 'cus_1', email: USER.email }],
    stripeSubs: [
      { id: 'sub_dead', customer: 'cus_1', status: 'canceled' },
      { id: 'sub_live', customer: 'cus_1', status: 'trialing' },
    ],
  }, async (s) => {
    await post();
    const cancels = s.calls.filter((c) => c.kind === 'stripe_cancel').map((c) => c.id);
    assert.ok(cancels.includes('sub_live'), 'the trialing one must be cancelled');
    assert.ok(!cancels.includes('sub_dead'), 'a canceled one must not be touched');
  });
});

test('a restaurant acquired mid-deletion is refused, not orphaned', async () => {
  /**
   * Completeness finding #1. The ownership guard is a check; the auth-user
   * delete is the act; between them is a window. restaurants.owner_id is
   * `on delete set null`, and findOrAdoptRestaurant treats a null owner as
   * adoptable — so orphaning a real restaurant hands it to whoever claims the
   * slug next. The re-read right before the delete refuses instead.
   */
  await withStub({
    profiles: [{ id: 'user_kai' }],
    // First read (the top guard): no real restaurant. Second read (the
    // pre-delete re-check): a real one appeared.
    restaurantsMidDelete: [{ id: 'r_new', demo: false }],
  }, async (s) => {
    const res = await post();
    assert.equal(res.status, 409, 'must refuse rather than orphan the business');
    assert.equal((await res.json()).code, 'owns_restaurant');
    assert.equal(s.calls.some((c) => c.kind === 'auth_delete'), false, 'the auth user must not be deleted');
  });
});

test('splits are detached, not destroyed', async () => {
  /**
   * A split belongs to everybody who ate at that table. Deleting one would take
   * other diners' records of what they paid with it, which is somebody else's
   * data being erased on a third party's request.
   */
  await withStub({}, async (s) => {
    await post();
    const sessions = s.calls.find((c) => c.kind === 'patch' && c.table === 'sessions');
    assert.ok(sessions, 'sessions were never detached');
    assert.deepEqual(sessions.body, { created_by_id: null });
    assert.equal(s.calls.some((c) => c.kind === 'delete' && c.table === 'sessions'), false,
      'a split must never be deleted on one participant request');
  });
});

test('the audit log is pseudonymised rather than purged', async () => {
  // It is append-only and it is what a payment dispute is settled from. The
  // identity goes; the evidence stays.
  await withStub({}, async (s) => {
    await post();
    const log = s.calls.find((c) => c.kind === 'patch' && c.table === 'audit_log');
    assert.ok(log, 'the audit log was never touched');
    assert.deepEqual(log.body, { actor_user_id: null });
    assert.equal(s.calls.some((c) => c.kind === 'delete' && c.table === 'audit_log'), false);
  });
});

test('demo pages this person stood up are deleted outright, with their guest rows', async () => {
  // They carry a real business's name and were never theirs to keep.
  await withStub({
    restaurants: [{ id: 'd1', owner_id: 'user_kai', name: 'Mariposa', slug: 'x7k', demo: true }],
  }, async (s) => {
    const res = await post();
    assert.equal(res.status, 200);
    assert.equal(s.tables.restaurants.length, 0);
    for (const table of ['guest_ratings', 'guest_contacts']) {
      assert.ok(s.calls.some((c) => c.kind === 'delete' && c.table === table), `${table} survived`);
    }
  });
});

test('a failure to delete the auth user is a 500, never a cheerful 200', async () => {
  /**
   * The worst outcome available here: everything else removed, the sign-in
   * left working, and the person told their account is gone. They would have no
   * reason to ask again.
   */
  await withStub({ authStatus: 500, profiles: [{ id: 'user_kai' }] }, async (s) => {
    const res = await post();
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.ok, undefined);
    assert.equal(body.code, 'incomplete');
    assert.ok(authDeleted(s), 'it was attempted');
  });
});

test('an auth user already gone is not an error', async () => {
  // Retrying a deletion that half-finished must be able to complete rather than
  // failing forever on the one row that did land.
  await withStub({ authStatus: 404 }, async () => {
    assert.equal((await post()).status, 200);
  });
});

test('an unconfigured deployment refuses rather than half-deleting', async () => {
  const { SUPABASE_SERVICE_ROLE_KEY, ...rest } = ENV;
  await withStub({}, async (s) => {
    const res = await post({ confirm: 'DELETE' }, rest);
    assert.equal(res.status, 503);
    assert.equal(authDeleted(s), false);
  });
});
