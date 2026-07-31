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

test('a guest cannot claim an item someone else already holds', async () => {
  const env = stubEnv({
    ...baseSession,
    items: [{ id: 'i1', name: 'Steak', price: 20, quantity: 1, claimed_by: [ALICE] }],
    participants: [{ participant_id: ALICE, name: 'Alice', amount_owed: 20, payment_status: 'unpaid' }],
  });
  const restore = installFetch(env.__store);
  try {
    const res = await HANDLERS.joinSession({
      env,
      body: {
        session_id: 's1', participant_id: BOB, name: 'Bob',
        items: [{ id: 'i1', claimed_by: [BOB] }],
      },
    });
    assert.equal(res.status, 409);
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
