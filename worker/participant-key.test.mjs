/**
 * One diner cannot act as another.
 *
 * participant_id was the whole of the proof, and scopeForParticipant publishes
 * every participant's id to everyone at the table on every poll — it has to, so
 * the table can see who claimed what and who has settled. The thing that
 * authorised being a diner was therefore handed to everyone who could be that
 * diner's attacker, and to anyone the claim link reached.
 *
 * Measured against the handlers before participant keys existed, a diner
 * holding nothing but the link could read another's exact share, report them as
 * having paid, and release their item claims so they owed nothing and the table
 * came up short. Each of those is a test here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HANDLERS } from './routes/functions.js';

const ALICE = 'p_1700000000000_alice1';
const BOB = 'p_1700000000001_bobbbb';

const ENV = {
  DATA_BACKEND: 'supabase',
  SUPABASE_URL: 'https://stub.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
};

function stub(seed) {
  const store = { sessions: [structuredClone(seed)] };
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const from = u.pathname.replace('/rest/v1/', '').split('?')[0];
    const rows = store[from] || [];
    const matches = (row) => {
      for (const [k, v] of u.searchParams) {
        if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
        if (String(v).startsWith('eq.') && String(row[k]) !== String(v).slice(3)) return false;
      }
      return true;
    };
    if (init.method === 'PATCH') {
      const hit = rows.find(matches);
      if (!hit) return new Response('[]', { status: 200 });
      Object.assign(hit, JSON.parse(init.body));
      return new Response(JSON.stringify([structuredClone(hit)]), { status: 200 });
    }
    return new Response(
      JSON.stringify(rows.filter(matches).map((r) => structuredClone(r))),
      { status: 200 },
    );
  };
  return { store, restore: () => { globalThis.fetch = original; } };
}

const freshSplit = () => ({
  id: 's1',
  title: 'Dinner',
  split_mode: 'itemized',
  status: 'claiming',
  total_amount: 60,
  tax: 0,
  tip: 0,
  version: 0,
  expires_at: Date.now() + 86400000,
  items: [
    { id: 'i1', name: 'Steak', price: 40, quantity: 1, claimed_by: [] },
    { id: 'i2', name: 'Salad', price: 20, quantity: 1, claimed_by: [] },
  ],
  participants: [],
});

const bodyOf = async (res) => res.json();

/** Joins both diners the way a browser does, keeping each key. */
async function seatTable(env) {
  const alice = await bodyOf(await HANDLERS.joinSession({
    env,
    body: {
      session_id: 's1', participant_id: ALICE, name: 'Alice',
      items: [{ id: 'i1', claimed_by: [ALICE] }],
    },
  }));
  const bob = await bodyOf(await HANDLERS.joinSession({
    env,
    body: {
      session_id: 's1', participant_id: BOB, name: 'Bob',
      items: [{ id: 'i2', claimed_by: [BOB] }],
    },
  }));
  return { aliceKey: alice.participant_key, bobKey: bob.participant_key };
}

test('joining hands back a key, once', async () => {
  const { restore } = stub(freshSplit());
  try {
    const { aliceKey } = await seatTable(ENV);
    assert.ok(aliceKey, 'the first join mints one');

    const again = await bodyOf(await HANDLERS.joinSession({
      env: ENV,
      body: { session_id: 's1', participant_id: ALICE, participant_key: aliceKey, items: [] },
    }));
    assert.equal(again.participant_key, undefined, 'and later joins do not reissue it');
  } finally {
    restore();
  }
});

test('the key never leaves the Worker, only its hash is stored', async () => {
  const { store, restore } = stub(freshSplit());
  try {
    const { aliceKey } = await seatTable(ENV);
    const row = store.sessions[0].participants.find((p) => p.participant_id === ALICE);
    assert.ok(row.participant_key_hash, 'a hash is stored');
    assert.notEqual(row.participant_key_hash, aliceKey, 'and it is not the key');
    assert.match(row.participant_key_hash, /^[0-9a-f]{64}$/);
  } finally {
    restore();
  }
});

test("a diner cannot read another diner's share by replaying their id", async () => {
  const { restore } = stub(freshSplit());
  try {
    const { aliceKey } = await seatTable(ENV);

    // Alice's own view. It lists every participant id — it has to.
    const mine = (await bodyOf(await HANDLERS.getSplitStatus({
      env: ENV,
      body: { session_id: 's1', participant_id: ALICE, participant_key: aliceKey },
    }))).session;
    assert.equal(mine.participants.find((p) => p.participant_id === ALICE).amount_owed, 40);
    assert.ok(mine.participants.some((p) => p.participant_id === BOB), "Bob's id is in the response");

    // So she asks again as Bob, with the id she was just handed.
    const his = (await bodyOf(await HANDLERS.getSplitStatus({
      env: ENV,
      body: { session_id: 's1', participant_id: BOB },
    }))).session;
    const bob = his.participants.find((p) => p.participant_id === BOB);
    assert.equal(bob.amount_owed, undefined, "Bob's share stays Bob's");
    assert.equal(bob.paid_amount, undefined);
    assert.equal(bob.paid_at, undefined);
  } finally {
    restore();
  }
});

test('a wrong key is no better than no key', async () => {
  const { restore } = stub(freshSplit());
  try {
    await seatTable(ENV);
    const his = (await bodyOf(await HANDLERS.getSplitStatus({
      env: ENV,
      body: { session_id: 's1', participant_id: BOB, participant_key: 'not-the-key' },
    }))).session;
    assert.equal(his.participants.find((p) => p.participant_id === BOB).amount_owed, undefined);
  } finally {
    restore();
  }
});

test('a diner cannot report someone else as having paid', async () => {
  // The one with a price on it. A host who believes a diner has sent money
  // stops chasing them, and the table is short by that diner's share.
  const { store, restore } = stub(freshSplit());
  try {
    await seatTable(ENV);
    await assert.rejects(
      () => HANDLERS.markMePaid({ env: ENV, body: { session_id: 's1', participant_id: BOB } }),
      (error) => {
        assert.equal(error.status, 403);
        assert.equal(error.code, 'not_participant');
        return true;
      },
    );
    const bob = store.sessions[0].participants.find((p) => p.participant_id === BOB);
    assert.equal(bob.payment_status, 'unpaid', 'Bob still owes it');
  } finally {
    restore();
  }
});

test('a diner can still report themselves', async () => {
  const { store, restore } = stub(freshSplit());
  try {
    const { bobKey } = await seatTable(ENV);
    await HANDLERS.markMePaid({
      env: ENV,
      body: { session_id: 's1', participant_id: BOB, participant_key: bobKey },
    });
    const bob = store.sessions[0].participants.find((p) => p.participant_id === BOB);
    assert.equal(bob.payment_status, 'pending_verification');
  } finally {
    restore();
  }
});

test("a diner cannot release someone else's claims", async () => {
  const { store, restore } = stub(freshSplit());
  try {
    await seatTable(ENV);
    await assert.rejects(
      () => HANDLERS.joinSession({
        env: ENV,
        body: {
          session_id: 's1', participant_id: BOB, name: 'Bob was here',
          items: [{ id: 'i2', claimed_by: [] }],
        },
      }),
      (error) => {
        assert.equal(error.status, 403);
        assert.equal(error.code, 'not_participant');
        return true;
      },
    );

    const after = store.sessions[0];
    assert.deepEqual(after.items.find((i) => i.id === 'i2').claimed_by, [BOB], 'salad still his');
    const bob = after.participants.find((p) => p.participant_id === BOB);
    assert.equal(bob.name, 'Bob', 'and he has not been renamed');
    assert.equal(bob.amount_owed, 20, 'and still owes his share');
    const owed = after.participants.reduce((s, p) => s + (p.amount_owed || 0), 0);
    assert.equal(owed, 60, 'the table is still paying the whole bill');
  } finally {
    restore();
  }
});

test("the host's view carries no diner's key hash", async () => {
  // The same argument that keeps host_key_hash off the wire, made about six
  // smaller hashes sitting inside the participants array.
  const { store, restore } = stub(freshSplit());
  try {
    await seatTable(ENV);
    const hostKey = 'hostsecret';
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(hostKey));
    store.sessions[0].host_key_hash = [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, '0')).join('');

    const res = await HANDLERS.getSessionAsHost({
      env: ENV,
      request: new Request('https://billtap.app/api/fn/getSessionAsHost', { method: 'POST' }),
      body: { session_id: 's1', host_key: hostKey },
    });
    const { session } = await res.json();
    assert.equal(session.host_key_hash, undefined);
    for (const p of session.participants) {
      assert.equal(p.participant_key_hash, undefined, `${p.name}'s hash travelled`);
    }
    // And the host still sees what they need to.
    assert.equal(session.participants.length, 2);
    assert.equal(session.participants.find((p) => p.participant_id === BOB).amount_owed, 20);
  } finally {
    restore();
  }
});

test('a split already in flight is not broken by this', async () => {
  // Splits live thirty days, so on the day this ships every one of them has
  // participants with no stored hash. Refusing those would strand tables
  // mid-meal with no way to obtain a key for a row that has none.
  const legacy = freshSplit();
  legacy.participants = [
    { participant_id: ALICE, name: 'Alice', amount_owed: 40, payment_status: 'unpaid' },
    { participant_id: BOB, name: 'Bob', amount_owed: 20, payment_status: 'unpaid' },
  ];
  legacy.items[0].claimed_by = [ALICE];
  legacy.items[1].claimed_by = [BOB];

  const { store, restore } = stub(legacy);
  try {
    // Alice can still see her own share and still mark herself paid.
    const view = (await bodyOf(await HANDLERS.getSplitStatus({
      env: ENV, body: { session_id: 's1', participant_id: ALICE },
    }))).session;
    assert.equal(view.participants.find((p) => p.participant_id === ALICE).amount_owed, 40);

    await HANDLERS.markMePaid({ env: ENV, body: { session_id: 's1', participant_id: ALICE } });
    assert.equal(
      store.sessions[0].participants.find((p) => p.participant_id === ALICE).payment_status,
      'pending_verification',
    );

    // And her next join mints the key, closing the window for her row.
    const rejoin = await bodyOf(await HANDLERS.joinSession({
      env: ENV, body: { session_id: 's1', participant_id: ALICE, items: [] },
    }));
    assert.ok(rejoin.participant_key, 'a key is issued to a row that had none');
    assert.ok(
      store.sessions[0].participants.find((p) => p.participant_id === ALICE).participant_key_hash,
      'and stored',
    );
  } finally {
    restore();
  }
});

test('a key is never rotated out from under a diner who holds one', async () => {
  const { store, restore } = stub(freshSplit());
  try {
    const { aliceKey } = await seatTable(ENV);
    const hashBefore = store.sessions[0].participants
      .find((p) => p.participant_id === ALICE).participant_key_hash;

    await HANDLERS.joinSession({
      env: ENV,
      body: { session_id: 's1', participant_id: ALICE, participant_key: aliceKey, items: [] },
    });

    assert.equal(
      store.sessions[0].participants.find((p) => p.participant_id === ALICE).participant_key_hash,
      hashBefore,
      'the same hash, or the diner is locked out of their own share',
    );
  } finally {
    restore();
  }
});
