/**
 * Covers the ported functions' logic that the audit found broken.
 *
 * The concurrent-claim case in particular: joinSession used to write the
 * client's whole items array back, so two diners claiming at once meant the
 * second save silently erased the first. That is a money bug at a real table
 * and nothing tested it, which is how it survived.
 *
 * These drive the handlers directly with a stubbed Base44 layer, so they run
 * offline and assert behaviour rather than wiring.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HANDLERS } from './routes/functions.js';

/** Minimal in-memory stand-in for the entity API, seeded with one session. */
function stubEnv(session) {
  const store = { Session: [structuredClone(session)] };
  globalThis.__stub = store;
  return {
    BASE44_APP_ID: 'testapp',
    BASE44_MASTER_KEY: 'test-key',
    __store: store,
  };
}

// The handlers reach Base44 over fetch; intercept it and serve from the store.
function installFetch(store) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const m = u.pathname.match(/\/entities\/([A-Za-z]+)(?:\/([^/]+))?$/);
    if (!m) return new Response('{}', { status: 404 });
    const [, entity, id] = m;
    const rows = store[entity] || (store[entity] = []);

    if (init.method === 'PUT' && id) {
      const row = rows.find((r) => r.id === id);
      Object.assign(row, JSON.parse(init.body));
      return new Response(JSON.stringify(row), { status: 200 });
    }
    if (init.method === 'POST') {
      const row = { id: `id_${rows.length + 1}`, ...JSON.parse(init.body) };
      rows.push(row);
      return new Response(JSON.stringify(row), { status: 200 });
    }
    if (id) {
      const row = rows.find((r) => r.id === id);
      return row
        ? new Response(JSON.stringify(row), { status: 200 })
        : new Response('{}', { status: 404 });
    }
    return new Response(JSON.stringify(rows), { status: 200 });
  };
  return () => { globalThis.fetch = original; };
}

const baseSession = {
  id: 's1',
  split_mode: 'itemized',
  total_amount: 30,
  tax: 0,
  tip: 0,
  status: 'waiting',
  expires_at: Date.now() + 86400000,
  items: [
    { id: 'i1', name: 'Steak', price: 20, quantity: 1, claimed_by: [] },
    { id: 'i2', name: 'Salad', price: 10, quantity: 1, claimed_by: [] },
  ],
  participants: [],
};

const ALICE = 'p_1700000000000_aaa';
const BOB = 'p_1700000000001_bbb';

test('a second diner claiming does not erase the first diner claim', async () => {
  const env = stubEnv(baseSession);
  const restore = installFetch(env.__store);
  try {
    // Alice claims the steak.
    await HANDLERS.joinSession({
      env,
      body: {
        session_id: 's1', participant_id: ALICE, name: 'Alice',
        items: [{ id: 'i1', claimed_by: [ALICE] }, { id: 'i2', claimed_by: [] }],
      },
    });

    // Bob claims the salad from a snapshot taken BEFORE Alice saved — his
    // items array still shows the steak unclaimed. The old code wrote that
    // array verbatim and Alice's claim vanished.
    await HANDLERS.joinSession({
      env,
      body: {
        session_id: 's1', participant_id: BOB, name: 'Bob',
        items: [{ id: 'i1', claimed_by: [] }, { id: 'i2', claimed_by: [BOB] }],
      },
    });

    const stored = env.__store.Session[0];
    const steak = stored.items.find((i) => i.id === 'i1');
    const salad = stored.items.find((i) => i.id === 'i2');

    assert.deepEqual(steak.claimed_by, [ALICE], 'Alice keeps the steak');
    assert.deepEqual(salad.claimed_by, [BOB], 'Bob gets the salad');
    assert.equal(stored.participants.length, 2, 'both diners are in the session');
  } finally {
    restore();
  }
});

test('a guest joining an item someone else holds splits it rather than being refused', async () => {
  // The shared plate: nachos, the bottle of wine, the dessert with two forks.
  // This used to be a 409 — one item, one person — which left whoever tapped
  // first paying for all of something two people ate.
  const env = stubEnv({
    ...baseSession,
    items: [{ id: 'i1', name: 'Steak', price: 20, quantity: 1, claimed_by: [ALICE] }],
    participants: [{ participant_id: ALICE, name: 'Alice', amount_owed: 20, payment_status: 'unpaid' }],
  });
  const restore = installFetch(env.__store);
  try {
    await HANDLERS.joinSession({
      env,
      body: {
        session_id: 's1', participant_id: BOB, name: 'Bob',
        items: [{ id: 'i1', claimed_by: [BOB] }],
      },
    });

    const stored = env.__store.Session[0];
    // Alice is still on it — joining adds, it never displaces.
    assert.deepEqual(stored.items[0].claimed_by, [ALICE, BOB]);

    // And the $20 steak is now $10 each rather than $20 for whoever was quicker.
    const alice = stored.participants.find((p) => p.participant_id === ALICE);
    const bob = stored.participants.find((p) => p.participant_id === BOB);
    assert.equal(alice.amount_owed, 10);
    assert.equal(bob.amount_owed, 10);
  } finally {
    restore();
  }
});

test('an item whose claimer has already settled cannot be joined', async () => {
  // The one case sharing must still refuse. A paid diner's amount is frozen,
  // so it cannot be recomputed downward to make room — Alice pays $20 alone,
  // Bob joins and is quoted $10, and the host collects $30 for a $20 steak.
  const env = stubEnv({
    ...baseSession,
    items: [{ id: 'i1', name: 'Steak', price: 20, quantity: 1, claimed_by: [ALICE] }],
    participants: [{ participant_id: ALICE, name: 'Alice', amount_owed: 20, payment_status: 'paid' }],
  });
  const restore = installFetch(env.__store);
  try {
    await assert.rejects(
      () => HANDLERS.joinSession({
        env,
        body: {
          session_id: 's1', participant_id: BOB, name: 'Bob',
          items: [{ id: 'i1', claimed_by: [BOB] }],
        },
      }),
      (error) => {
        assert.equal(error.name, 'AppError');
        assert.equal(error.status, 409);
        assert.equal(error.code, 'item_settled');
        return true;
      },
    );

    // And Bob's attempt changed nothing.
    assert.deepEqual(env.__store.Session[0].items[0].claimed_by, [ALICE]);
    assert.equal(env.__store.Session[0].participants[0].amount_owed, 20, "Alice's settled amount is untouched");
  } finally {
    restore();
  }
});

test('joinSession ignores a payment_status sent by the client', async () => {
  const env = stubEnv({
    ...baseSession,
    participants: [{ participant_id: ALICE, name: 'Alice', amount_owed: 20, payment_status: 'unpaid' }],
  });
  const restore = installFetch(env.__store);
  try {
    // Bob tries to mark Alice paid by including her row.
    await HANDLERS.joinSession({
      env,
      body: {
        session_id: 's1', participant_id: BOB, name: 'Bob',
        participants: [{ participant_id: ALICE, payment_status: 'paid' }],
        items: [],
      },
    });
    const alice = env.__store.Session[0].participants.find((p) => p.participant_id === ALICE);
    assert.equal(alice.payment_status, 'unpaid', 'Alice is still unpaid');
  } finally {
    restore();
  }
});

test('markMePaid marks only the caller, and as pending_verification', async () => {
  const env = stubEnv({
    ...baseSession,
    participants: [
      { participant_id: ALICE, name: 'Alice', amount_owed: 20, payment_status: 'unpaid' },
      { participant_id: BOB, name: 'Bob', amount_owed: 10, payment_status: 'unpaid' },
    ],
  });
  const restore = installFetch(env.__store);
  try {
    await HANDLERS.markMePaid({ env, body: { session_id: 's1', participant_id: ALICE } });
    const [alice, bob] = env.__store.Session[0].participants;
    assert.equal(alice.payment_status, 'pending_verification');
    assert.equal(bob.payment_status, 'unpaid', 'Bob is untouched');
  } finally {
    restore();
  }
});

test('a guest is not shown what anyone else owes', async () => {
  const env = stubEnv({
    ...baseSession,
    host_payment_info: { method: 'venmo', handle: 'host' },
    participants: [
      { participant_id: ALICE, name: 'Alice', amount_owed: 20, payment_status: 'unpaid' },
      { participant_id: BOB, name: 'Bob', amount_owed: 10, payment_status: 'unpaid' },
    ],
  });
  const restore = installFetch(env.__store);
  try {
    const res = await HANDLERS.markMePaid({ env, body: { session_id: 's1', participant_id: ALICE } });
    const { session } = await res.json();
    const alice = session.participants.find((p) => p.participant_id === ALICE);
    const bob = session.participants.find((p) => p.participant_id === BOB);
    assert.equal(alice.amount_owed, 20, 'the caller sees their own share');
    assert.equal(bob.amount_owed, undefined, "another diner's share is withheld");
  } finally {
    restore();
  }
});

// ── Genuine concurrency ─────────────────────────────────────────────────────
//
// The claim test above runs Alice's call to completion before Bob's begins, so
// what it proves is that a stale CLIENT array is ignored. It cannot see two
// handlers interleaved on the server, which is the case that actually happens:
// everyone at a table scans the same QR within the same fifteen seconds.
//
// Measured against the code before this suite existed, two concurrent joins
// erased Alice outright — absent from participants, her item claim cleared, her
// $20 of a $30 bill uncollected — while her phone was handed a 200.
//
// These use a PostgREST-shaped stub so that `version=eq.N` behaves the way
// Postgres does: the guard and the update are one statement, and a writer whose
// version has moved matches zero rows and is told so by an empty body. Without
// that the compare-and-swap in patchSession is untested by anything.

/**
 * A Supabase-backed env whose reads snapshot before the latency, so two callers
 * genuinely hold the same version of the row.
 */
function concurrentEnv(seed) {
  const store = { sessions: [structuredClone(seed)] };
  const original = globalThis.fetch;

  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const from = u.pathname.replace('/rest/v1/', '').split('?')[0];
    const rows = store[from] || (store[from] = []);

    const matches = (row) => {
      for (const [key, value] of u.searchParams) {
        if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
        if (!String(value).startsWith('eq.')) continue;
        if (String(row[key]) !== String(value).slice(3)) return false;
      }
      return true;
    };

    if (init.method === 'PATCH') {
      // Guard and update evaluated together. A stale version matches nothing.
      const hit = rows.find(matches);
      if (!hit) return new Response('[]', { status: 200 });
      Object.assign(hit, JSON.parse(init.body));
      return new Response(JSON.stringify([structuredClone(hit)]), { status: 200 });
    }

    const found = rows.filter(matches).map((r) => structuredClone(r));
    await new Promise((resolve) => setTimeout(resolve, 20));
    return new Response(JSON.stringify(found), { status: 200 });
  };

  return {
    env: {
      DATA_BACKEND: 'supabase',
      SUPABASE_URL: 'https://stub.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    },
    store,
    restore: () => { globalThis.fetch = original; },
  };
}

test('two diners joining at the same instant both survive', async () => {
  const { env, store, restore } = concurrentEnv({ ...baseSession, version: 0 });
  try {
    await Promise.all([
      HANDLERS.joinSession({
        env,
        body: {
          session_id: 's1', participant_id: ALICE, name: 'Alice',
          items: [{ id: 'i1', claimed_by: [ALICE] }, { id: 'i2', claimed_by: [] }],
        },
      }),
      HANDLERS.joinSession({
        env,
        body: {
          session_id: 's1', participant_id: BOB, name: 'Bob',
          items: [{ id: 'i1', claimed_by: [] }, { id: 'i2', claimed_by: [BOB] }],
        },
      }),
    ]);

    const stored = store.sessions[0];
    const names = stored.participants.map((p) => p.name).sort();
    assert.deepEqual(names, ['Alice', 'Bob'], 'neither diner was erased');

    const steak = stored.items.find((i) => i.id === 'i1').claimed_by;
    const salad = stored.items.find((i) => i.id === 'i2').claimed_by;
    assert.deepEqual(steak, [ALICE], 'Alice keeps the steak');
    assert.deepEqual(salad, [BOB], 'Bob keeps the salad');

    // The point of all of it: the table is still paying the whole bill.
    const owed = stored.participants.reduce((sum, p) => sum + (p.amount_owed || 0), 0);
    assert.equal(owed, 30, 'every dollar of the bill is assigned to somebody');

    // Two successful writes, so the loser did retry rather than silently win.
    assert.equal(stored.version, 2, 'both writes landed, each bumping the version');
  } finally {
    restore();
  }
});

test('a self-report is not erased by the host confirming someone else at the same moment', async () => {
  const { env, store, restore } = concurrentEnv({
    ...baseSession,
    version: 0,
    split_mode: 'even',
    status: 'claiming',
    host_key_hash: null,
    participants: [
      { participant_id: ALICE, name: 'Alice', amount_owed: 15, payment_status: 'unpaid' },
      { participant_id: BOB, name: 'Bob', amount_owed: 15, payment_status: 'unpaid' },
    ],
  });

  // The host proves themselves with the secret; only its hash is stored.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('hostsecret'));
  store.sessions[0].host_key_hash = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0')).join('');

  try {
    await Promise.all([
      HANDLERS.confirmPayment({
        env,
        request: new Request('https://billtap.app/api/fn/confirmPayment', { method: 'POST' }),
        body: { session_id: 's1', participant_id: ALICE, host_key: 'hostsecret', action: 'confirm' },
      }),
      HANDLERS.markMePaid({ env, body: { session_id: 's1', participant_id: BOB } }),
    ]);

    const stored = store.sessions[0];
    const alice = stored.participants.find((p) => p.participant_id === ALICE);
    const bob = stored.participants.find((p) => p.participant_id === BOB);

    assert.equal(alice.payment_status, 'paid', "the host's confirmation stands");
    assert.equal(
      bob.payment_status,
      'pending_verification',
      "Bob said he had sent it and the session still says so",
    );
    assert.equal(stored.version, 2, 'both writes landed');
  } finally {
    restore();
  }
});
