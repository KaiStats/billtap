/**
 * The payment verification loop.
 *
 * This is the part of BillTap where the app stops being a calculator and starts
 * making a claim about money in the real world. The money itself moves outside
 * the product — diner to host, over Venmo or Cash App or Zelle — so "paid" is
 * not something the system can observe. It is a statement by the one person who
 * can see the transfer land: the host.
 *
 * That makes two things load-bearing, and both are tested here:
 *
 *   1. Only the host can say it. Before this, src/pages/ReceiptDetail.jsx
 *      decided who was host from a `?host=1` query parameter and then wrote the
 *      whole participants array straight to the entity.
 *   2. Once said, it stops moving. Shares are recalculated on every join, so a
 *      settled diner's amount would drift underneath a confirmation that had
 *      already been given.
 *
 * The stub mirrors worker/api.test.mjs: an in-memory Base44 over fetch, no
 * network and no credentials.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { errorResponse } from './lib/errors.js';
import { HANDLERS } from './routes/functions.js';

const MASTER = 'test-master-key';
const HOST_COOKIE = 'base44_session=host-token';
const OTHER_COOKIE = 'base44_session=someone-else';
const HOST_USER = { id: 'user_host' };
const OTHER_USER = { id: 'user_other' };

const ALICE = 'p_1700000000000_aaa';
const BOB = 'p_1700000000001_bbb';
const CARA = 'p_1700000000002_ccc';

function stub({ entities = {}, users = {} } = {}) {
  const store = structuredClone(entities);
  const env = { BASE44_APP_ID: 'testapp', BASE44_MASTER_KEY: MASTER, __store: store };
  const original = globalThis.fetch;

  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    const auth = init.headers?.Authorization || init.headers?.Cookie || null;

    if (u.pathname.endsWith('/entities/User/me')) {
      const who = users[auth];
      return who
        ? new Response(JSON.stringify(who), { status: 200 })
        : new Response('{"error":"unauthorized"}', { status: 401 });
    }

    const m = u.pathname.match(/\/entities\/([A-Za-z]+)(?:\/([^/]+))?$/);
    if (!m) return new Response('{}', { status: 404 });
    const [, entity, id] = m;
    const rows = store[entity] || (store[entity] = []);

    if (method === 'PUT' && id) {
      const row = rows.find((r) => r.id === decodeURIComponent(id));
      if (!row) return new Response('{}', { status: 404 });
      Object.assign(row, JSON.parse(init.body));
      return new Response(JSON.stringify(row), { status: 200 });
    }
    if (method === 'POST') {
      const row = { id: `${entity.toLowerCase()}_${rows.length + 1}`, created_date: new Date().toISOString(), ...JSON.parse(init.body) };
      rows.push(row);
      return new Response(JSON.stringify(row), { status: 200 });
    }
    if (id) {
      const row = rows.find((r) => r.id === decodeURIComponent(id));
      return row ? new Response(JSON.stringify(row), { status: 200 }) : new Response('{}', { status: 404 });
    }
    let out = rows;
    for (const [k, v] of u.searchParams) {
      if (['sort', 'limit', 'offset'].includes(k)) continue;
      out = out.filter((r) => String(r[k]) === v);
    }
    return new Response(JSON.stringify(out), { status: 200 });
  };

  return { env, store, restore: () => { globalThis.fetch = original; } };
}

const req = (cookie) =>
  new Request('https://billtap.app/api/fn/confirmPayment', {
    method: 'POST',
    headers: cookie ? { cookie } : {},
  });

async function withStub(opts, fn) {
  const s = stub(opts);
  try { return await fn(s); } finally { s.restore(); }
}

const body = (res) => res.json();

/**
 * Calls a handler the way onRequestPost does.
 *
 * An authorization failure is a thrown AppError now rather than a returned
 * Response, so that the status, the machine-readable code, the request id and
 * the audit row are produced in one place instead of thirteen. The dispatcher
 * turns that throw into what the caller receives; this does the same, so every
 * assertion below stays about what a client actually gets back.
 */
const asResponse = async (promise) => {
  try {
    return await promise;
  } catch (error) {
    return errorResponse(error, { id: 'test00', route: 'test' });
  }
};

const confirm = (env, request, b) => asResponse(HANDLERS.confirmPayment({ env, request, body: b }));
const join = (env, b) => HANDLERS.joinSession({ env, body: b });
const hostView = (env, request, b) => asResponse(HANDLERS.getSessionAsHost({ env, request, body: b }));

/**
 * Creates a real split through createSession so the host key is minted the way
 * production mints it, rather than being faked into the fixture.
 */
async function newSplit({ env, request = req(), overrides = {} } = {}) {
  const res = await HANDLERS.createSession({
    env,
    request,
    body: {
      title: 'Dinner',
      restaurant_slug: 'joes',
      items: [
        { id: 'i1', name: 'Steak', price: 20, quantity: 1, claimed_by: [] },
        { id: 'i2', name: 'Salad', price: 10, quantity: 1, claimed_by: [] },
      ],
      tax: 0, tip: 0, split_mode: 'itemized',
      ...overrides,
    },
  });
  const out = await body(res);
  return { session: out.session, hostKey: out.host_key };
}

const RESTAURANT = { entities: { Restaurant: [{ id: 'r1', slug: 'joes' }] } };

// ── Minting the host key ────────────────────────────────────────────────────

test('creating a split hands back a host key exactly once', async () => {
  await withStub(RESTAURANT, async ({ env }) => {
    const { hostKey } = await newSplit({ env });
    assert.equal(typeof hostKey, 'string');
    assert.ok(hostKey.length >= 24, 'a guessable host key is no key at all');
  });
});

test('the host key is stored only as a hash, never in the clear', async () => {
  await withStub(RESTAURANT, async ({ env, store }) => {
    const { hostKey } = await newSplit({ env });
    const row = store.Session[0];
    assert.ok(row.host_key_hash, 'the session records a hash');
    assert.notEqual(row.host_key_hash, hostKey);
    assert.match(row.host_key_hash, /^[0-9a-f]{64}$/, 'SHA-256 hex');
    assert.ok(!JSON.stringify(row).includes(hostKey), 'the secret itself is nowhere in the row');
  });
});

test('two splits never share a host key', async () => {
  await withStub(RESTAURANT, async ({ env }) => {
    const a = await newSplit({ env });
    const b = await newSplit({ env });
    assert.notEqual(a.hostKey, b.hostKey);
  });
});

test('the session handed back to the creator carries no host key hash', async () => {
  await withStub(RESTAURANT, async ({ env }) => {
    const { session } = await newSplit({ env });
    assert.equal(session.host_key_hash, undefined);
  });
});

// ── Who may confirm ─────────────────────────────────────────────────────────

test('the host key lets a guest host confirm a payment', async () => {
  await withStub(RESTAURANT, async ({ env, store }) => {
    const { session, hostKey } = await newSplit({ env });
    await join(env, { session_id: session.id, participant_id: ALICE, name: 'Alice', items: [{ id: 'i1', claimed_by: [ALICE] }] });

    const res = await confirm(env, req(), { session_id: session.id, participant_id: ALICE, host_key: hostKey });
    assert.equal(res.status, 200);
    assert.equal(store.Session[0].participants[0].payment_status, 'paid');
  });
});

test('a diner with no host key cannot confirm anyone, including themselves', async () => {
  await withStub(RESTAURANT, async ({ env, store }) => {
    const { session } = await newSplit({ env });
    await join(env, { session_id: session.id, participant_id: ALICE, name: 'Alice', items: [{ id: 'i1', claimed_by: [ALICE] }] });

    const res = await confirm(env, req(), { session_id: session.id, participant_id: ALICE });
    assert.equal(res.status, 403);
    assert.match((await body(res)).error, /Only the host/);
    assert.equal(store.Session[0].participants[0].payment_status, 'unpaid');
  });
});

test('a wrong host key is refused', async () => {
  await withStub(RESTAURANT, async ({ env, store }) => {
    const { session } = await newSplit({ env });
    await join(env, { session_id: session.id, participant_id: ALICE, name: 'Alice', items: [] });

    for (const guess of ['', 'hostkey', 'a'.repeat(32), null, 12345, {}]) {
      const res = await confirm(env, req(), { session_id: session.id, participant_id: ALICE, host_key: guess });
      assert.equal(res.status, 403, `"${JSON.stringify(guess)}" must not pass`);
    }
    assert.equal(store.Session[0].participants[0].payment_status, 'unpaid');
  });
});

test("one split's host key does not work on another split", async () => {
  await withStub(RESTAURANT, async ({ env }) => {
    const mine = await newSplit({ env });
    const theirs = await newSplit({ env });
    await join(env, { session_id: theirs.session.id, participant_id: ALICE, name: 'A', items: [] });

    const res = await confirm(env, req(), {
      session_id: theirs.session.id, participant_id: ALICE, host_key: mine.hostKey,
    });
    assert.equal(res.status, 403, 'a host is host of their own table only');
  });
});

test('a signed-in owner is the host without needing the key', async () => {
  await withStub({
    entities: { Restaurant: [{ id: 'r1', slug: 'joes' }] },
    users: { [HOST_COOKIE]: HOST_USER },
  }, async ({ env, store }) => {
    const { session } = await newSplit({ env, request: req(HOST_COOKIE) });
    // Base44 stamps created_by_id on a write made as the caller; the stub does
    // not model that, so set it the way Base44 would.
    store.Session[0].created_by_id = 'user_host';
    await join(env, { session_id: session.id, participant_id: ALICE, name: 'A', items: [{ id: 'i1', claimed_by: [ALICE] }] });

    const res = await confirm(env, req(HOST_COOKIE), { session_id: session.id, participant_id: ALICE });
    assert.equal(res.status, 200);
    assert.equal(store.Session[0].participants[0].payment_status, 'paid');
  });
});

test('a different signed-in user is not the host', async () => {
  await withStub({
    entities: { Restaurant: [{ id: 'r1', slug: 'joes' }] },
    users: { [HOST_COOKIE]: HOST_USER, [OTHER_COOKIE]: OTHER_USER },
  }, async ({ env, store }) => {
    const { session } = await newSplit({ env, request: req(HOST_COOKIE) });
    store.Session[0].created_by_id = 'user_host';
    await join(env, { session_id: session.id, participant_id: ALICE, name: 'A', items: [] });

    const res = await confirm(env, req(OTHER_COOKIE), { session_id: session.id, participant_id: ALICE });
    assert.equal(res.status, 403);
  });
});

test('an ownerless split cannot be claimed by simply signing in', async () => {
  // A table-tent split has no created_by_id. The ownership branch must not
  // treat "nobody owns this" as "everybody owns this".
  await withStub({
    entities: { Restaurant: [{ id: 'r1', slug: 'joes' }] },
    users: { [OTHER_COOKIE]: OTHER_USER },
  }, async ({ env, store }) => {
    const { session } = await newSplit({ env });
    assert.equal(store.Session[0].created_by_id, undefined);
    await join(env, { session_id: session.id, participant_id: ALICE, name: 'A', items: [] });

    const res = await confirm(env, req(OTHER_COOKIE), { session_id: session.id, participant_id: ALICE });
    assert.equal(res.status, 403);
  });
});

// ── What confirming records ─────────────────────────────────────────────────

test('confirming records what was settled and when', async () => {
  await withStub(RESTAURANT, async ({ env, store }) => {
    const { session, hostKey } = await newSplit({ env });
    await join(env, { session_id: session.id, participant_id: ALICE, name: 'Alice', items: [{ id: 'i1', claimed_by: [ALICE] }] });

    const before = Date.now();
    await confirm(env, req(), { session_id: session.id, participant_id: ALICE, host_key: hostKey });
    const alice = store.Session[0].participants[0];

    assert.equal(alice.payment_status, 'paid');
    assert.equal(alice.paid_amount, 20, 'the amount at the moment of confirmation');
    assert.ok(alice.paid_at >= before && alice.paid_at <= Date.now());
  });
});

test('a host can confirm someone who never tapped the button — cash at the table', async () => {
  await withStub(RESTAURANT, async ({ env, store }) => {
    const { session, hostKey } = await newSplit({ env });
    await join(env, { session_id: session.id, participant_id: ALICE, name: 'Alice', items: [{ id: 'i1', claimed_by: [ALICE] }] });
    assert.equal(store.Session[0].participants[0].payment_status, 'unpaid');

    const res = await confirm(env, req(), { session_id: session.id, participant_id: ALICE, host_key: hostKey });
    assert.equal(res.status, 200);
    assert.equal(store.Session[0].participants[0].payment_status, 'paid');
  });
});

test('confirming one diner leaves everyone else exactly as they were', async () => {
  await withStub(RESTAURANT, async ({ env, store }) => {
    const { session, hostKey } = await newSplit({ env });
    await join(env, { session_id: session.id, participant_id: ALICE, name: 'Alice', items: [{ id: 'i1', claimed_by: [ALICE] }] });
    await join(env, { session_id: session.id, participant_id: BOB, name: 'Bob', items: [{ id: 'i2', claimed_by: [BOB] }] });
    await HANDLERS.markMePaid({ env, body: { session_id: session.id, participant_id: BOB } });

    await confirm(env, req(), { session_id: session.id, participant_id: ALICE, host_key: hostKey });

    const [alice, bob] = store.Session[0].participants;
    assert.equal(alice.payment_status, 'paid');
    assert.equal(bob.payment_status, 'pending_verification', "Bob's own claim is untouched");
    assert.equal(bob.amount_owed, 10);
  });
});

test('confirming twice is a no-op, not a second record', async () => {
  await withStub(RESTAURANT, async ({ env, store }) => {
    const { session, hostKey } = await newSplit({ env });
    await join(env, { session_id: session.id, participant_id: ALICE, name: 'Alice', items: [{ id: 'i1', claimed_by: [ALICE] }] });

    await confirm(env, req(), { session_id: session.id, participant_id: ALICE, host_key: hostKey });
    const firstPaidAt = store.Session[0].participants[0].paid_at;

    const again = await confirm(env, req(), { session_id: session.id, participant_id: ALICE, host_key: hostKey });
    assert.equal(again.status, 200);
    assert.equal((await body(again)).unchanged, true);
    assert.equal(store.Session[0].participants[0].paid_at, firstPaidAt, 'the original timestamp stands');
  });
});

test('a host who taps the wrong row can take it back', async () => {
  await withStub(RESTAURANT, async ({ env, store }) => {
    const { session, hostKey } = await newSplit({ env });
    await join(env, { session_id: session.id, participant_id: ALICE, name: 'Alice', items: [{ id: 'i1', claimed_by: [ALICE] }] });

    await confirm(env, req(), { session_id: session.id, participant_id: ALICE, host_key: hostKey });
    await confirm(env, req(), { session_id: session.id, participant_id: ALICE, host_key: hostKey, action: 'undo' });

    const alice = store.Session[0].participants[0];
    assert.equal(alice.payment_status, 'unpaid');
    assert.equal(alice.paid_amount, undefined, 'the settlement record is cleared with it');
    assert.equal(alice.paid_at, undefined);
  });
});

test('only the host can undo a confirmation', async () => {
  await withStub(RESTAURANT, async ({ env, store }) => {
    const { session, hostKey } = await newSplit({ env });
    await join(env, { session_id: session.id, participant_id: ALICE, name: 'A', items: [{ id: 'i1', claimed_by: [ALICE] }] });
    await confirm(env, req(), { session_id: session.id, participant_id: ALICE, host_key: hostKey });

    const res = await confirm(env, req(), { session_id: session.id, participant_id: ALICE, action: 'undo' });
    assert.equal(res.status, 403);
    assert.equal(store.Session[0].participants[0].payment_status, 'paid');
  });
});

test('confirmPayment validates its inputs', async () => {
  await withStub(RESTAURANT, async ({ env }) => {
    const { session, hostKey } = await newSplit({ env });
    const bad = (b) => confirm(env, req(), { host_key: hostKey, ...b });

    assert.equal((await bad({ participant_id: ALICE })).status, 400, 'no session_id');
    assert.equal((await bad({ session_id: session.id, participant_id: 'nope' })).status, 400, 'bad participant shape');
    assert.equal((await bad({ session_id: session.id, participant_id: ALICE, action: 'delete' })).status, 400, 'unknown action');
    assert.equal((await bad({ session_id: 'missing', participant_id: ALICE })).status, 404, 'no such split');
  });
});

test('confirming somebody who never joined is a 404', async () => {
  await withStub(RESTAURANT, async ({ env }) => {
    const { session, hostKey } = await newSplit({ env });
    const res = await confirm(env, req(), { session_id: session.id, participant_id: CARA, host_key: hostKey });
    assert.equal(res.status, 404);
  });
});

// ── Completion ──────────────────────────────────────────────────────────────

test('a split completes only when the host has confirmed every diner', async () => {
  await withStub(RESTAURANT, async ({ env, store }) => {
    const { session, hostKey } = await newSplit({ env });
    await join(env, { session_id: session.id, participant_id: ALICE, name: 'A', items: [{ id: 'i1', claimed_by: [ALICE] }] });
    await join(env, { session_id: session.id, participant_id: BOB, name: 'B', items: [{ id: 'i2', claimed_by: [BOB] }] });

    // Both diners insist they have paid. That is not completion.
    await HANDLERS.markMePaid({ env, body: { session_id: session.id, participant_id: ALICE } });
    await HANDLERS.markMePaid({ env, body: { session_id: session.id, participant_id: BOB } });
    assert.equal(store.Session[0].status, 'claiming');

    await confirm(env, req(), { session_id: session.id, participant_id: ALICE, host_key: hostKey });
    assert.equal(store.Session[0].status, 'claiming', 'one of two is not everyone');

    await confirm(env, req(), { session_id: session.id, participant_id: BOB, host_key: hostKey });
    assert.equal(store.Session[0].status, 'completed');
  });
});

test('undoing a confirmation reopens a completed split', async () => {
  await withStub(RESTAURANT, async ({ env, store }) => {
    const { session, hostKey } = await newSplit({ env });
    await join(env, { session_id: session.id, participant_id: ALICE, name: 'A', items: [{ id: 'i1', claimed_by: [ALICE] }] });
    await confirm(env, req(), { session_id: session.id, participant_id: ALICE, host_key: hostKey });
    assert.equal(store.Session[0].status, 'completed');

    await confirm(env, req(), { session_id: session.id, participant_id: ALICE, host_key: hostKey, action: 'undo' });
    assert.equal(store.Session[0].status, 'claiming', 'an unsettled split is not a finished one');
  });
});

test('an empty split is never "everyone has paid"', async () => {
  await withStub(RESTAURANT, async ({ env, store }) => {
    await newSplit({ env });
    assert.equal(store.Session[0].status, 'waiting');
    assert.notEqual(store.Session[0].status, 'completed');
  });
});

// ── A confirmed amount stops moving ─────────────────────────────────────────

test('a later joiner cannot restate what a settled diner already paid', async () => {
  // The drift that makes an honest confirmation into a wrong one: in an even
  // split every arrival re-divides the total. Alice pays $30 of a $30 bill, the
  // host confirms it, then Bob joins — and Alice's share would silently become
  // $15 while she stays marked paid.
  await withStub(RESTAURANT, async ({ env, store }) => {
    const { session, hostKey } = await newSplit({
      env, overrides: { split_mode: 'even', total_amount: 30, items: [] },
    });
    await join(env, { session_id: session.id, participant_id: ALICE, name: 'Alice' });
    assert.equal(store.Session[0].participants[0].amount_owed, 30);

    await confirm(env, req(), { session_id: session.id, participant_id: ALICE, host_key: hostKey });
    await join(env, { session_id: session.id, participant_id: BOB, name: 'Bob' });

    const [alice, bob] = store.Session[0].participants;
    assert.equal(alice.amount_owed, 30, "Alice's settled share is frozen");
    assert.equal(alice.paid_amount, 30);
    assert.equal(alice.payment_status, 'paid');
    assert.equal(bob.amount_owed, 15, 'the arithmetic still runs for whoever still owes');
  });
});

test('a settled diner cannot go back and claim more', async () => {
  await withStub(RESTAURANT, async ({ env, store }) => {
    const { session, hostKey } = await newSplit({ env });
    await join(env, { session_id: session.id, participant_id: ALICE, name: 'Alice', items: [{ id: 'i1', claimed_by: [ALICE] }] });
    await confirm(env, req(), { session_id: session.id, participant_id: ALICE, host_key: hostKey });

    const res = await join(env, {
      session_id: session.id, participant_id: ALICE,
      items: [{ id: 'i1', claimed_by: [ALICE] }, { id: 'i2', claimed_by: [ALICE] }],
    });
    assert.equal(res.status, 409);
    assert.match((await body(res)).error, /already settled/i);
    assert.deepEqual(store.Session[0].items[1].claimed_by, [], 'the salad is still free');
    assert.equal(store.Session[0].participants[0].amount_owed, 20);
  });
});

test('un-confirming lets a diner carry on where they left off', async () => {
  await withStub(RESTAURANT, async ({ env, store }) => {
    const { session, hostKey } = await newSplit({ env });
    await join(env, { session_id: session.id, participant_id: ALICE, name: 'Alice', items: [{ id: 'i1', claimed_by: [ALICE] }] });
    await confirm(env, req(), { session_id: session.id, participant_id: ALICE, host_key: hostKey });
    await confirm(env, req(), { session_id: session.id, participant_id: ALICE, host_key: hostKey, action: 'undo' });

    const res = await join(env, {
      session_id: session.id, participant_id: ALICE,
      items: [{ id: 'i1', claimed_by: [ALICE] }, { id: 'i2', claimed_by: [ALICE] }],
    });
    assert.equal(res.status, 200);
    assert.equal(store.Session[0].participants[0].amount_owed, 30);
  });
});

test('two hosts confirming different diners at once do not erase each other', async () => {
  // The bug the raw Session.update in ReceiptDetail.jsx had: each device sent
  // its whole participants array, so the slower save reverted the faster one.
  await withStub(RESTAURANT, async ({ env, store }) => {
    const { session, hostKey } = await newSplit({ env });
    await join(env, { session_id: session.id, participant_id: ALICE, name: 'A', items: [{ id: 'i1', claimed_by: [ALICE] }] });
    await join(env, { session_id: session.id, participant_id: BOB, name: 'B', items: [{ id: 'i2', claimed_by: [BOB] }] });

    await Promise.all([
      confirm(env, req(), { session_id: session.id, participant_id: ALICE, host_key: hostKey }),
      confirm(env, req(), { session_id: session.id, participant_id: BOB, host_key: hostKey }),
    ]);

    const [alice, bob] = store.Session[0].participants;
    assert.equal(alice.payment_status, 'paid');
    assert.equal(bob.payment_status, 'paid');
  });
});

// ── The host's read ─────────────────────────────────────────────────────────

test('the host key opens the split for reading, which Base44 rules never would', async () => {
  await withStub(RESTAURANT, async ({ env }) => {
    const { session, hostKey } = await newSplit({ env });
    await join(env, { session_id: session.id, participant_id: ALICE, name: 'Alice', items: [{ id: 'i1', claimed_by: [ALICE] }] });

    const res = await hostView(env, req(), { session_id: session.id, host_key: hostKey });
    assert.equal(res.status, 200);
    const out = await body(res);
    assert.equal(out.session.participants.length, 1);
    assert.equal(out.session.participants[0].amount_owed, 20, 'a host sees every amount — that is the job');
  });
});

test('the host read never returns the hash that grants host rights', async () => {
  await withStub(RESTAURANT, async ({ env }) => {
    const { session, hostKey } = await newSplit({ env });
    const res = await hostView(env, req(), { session_id: session.id, host_key: hostKey });
    const out = await body(res);
    assert.equal(out.session.host_key_hash, undefined);
    assert.ok(!JSON.stringify(out).includes('host_key'));
  });
});

test('without the key the host read is refused, not merely empty', async () => {
  await withStub(RESTAURANT, async ({ env }) => {
    const { session } = await newSplit({ env });
    const res = await hostView(env, req(), { session_id: session.id });
    assert.equal(res.status, 403);
  });
});

test('the host read validates its input and reports a missing split honestly', async () => {
  await withStub(RESTAURANT, async ({ env }) => {
    assert.equal((await hostView(env, req(), {})).status, 400);
    assert.equal((await hostView(env, req(), { session_id: 'gone' })).status, 404);
  });
});

test('a diner still cannot see what the rest of the table owes', async () => {
  // The host gained a full view; the guest scope must not have widened with it.
  await withStub(RESTAURANT, async ({ env }) => {
    const { session } = await newSplit({ env });
    await join(env, { session_id: session.id, participant_id: ALICE, name: 'A', items: [{ id: 'i1', claimed_by: [ALICE] }] });
    const res = await join(env, { session_id: session.id, participant_id: BOB, name: 'B', items: [{ id: 'i2', claimed_by: [BOB] }] });

    const { session: scoped } = await body(res);
    const alice = scoped.participants.find((p) => p.participant_id === ALICE);
    assert.equal(alice.amount_owed, undefined);
    assert.equal(scoped.host_key_hash, undefined);
  });
});

test('a diner sees their own settlement record once the host confirms it', async () => {
  await withStub(RESTAURANT, async ({ env }) => {
    const { session, hostKey } = await newSplit({ env });
    await join(env, { session_id: session.id, participant_id: ALICE, name: 'A', items: [{ id: 'i1', claimed_by: [ALICE] }] });
    await confirm(env, req(), { session_id: session.id, participant_id: ALICE, host_key: hostKey });

    const res = await HANDLERS.markMePaid({ env, body: { session_id: session.id, participant_id: ALICE } });
    const { session: scoped } = await body(res);
    const me = scoped.participants.find((p) => p.participant_id === ALICE);
    assert.equal(me.payment_status, 'paid');
    assert.equal(me.paid_amount, 20);
  });
});

// ── The host's own settings ─────────────────────────────────────────────────
//
// Where the money should be sent, whether claiming has opened, and the amounts
// in a custom split. All three were raw Session.update calls from the browser,
// so all three were governed by a rule that a table-tent split can never
// satisfy — and the payment handle is the one the whole table depends on.

const settings = (env, request, b) => asResponse(HANDLERS.updateSplitSettings({ env, request, body: b }));

test('the host key lets a guest host say where the money should go', async () => {
  await withStub(RESTAURANT, async ({ env, store }) => {
    const { session, hostKey } = await newSplit({ env });
    const res = await settings(env, req(), {
      session_id: session.id, host_key: hostKey,
      host_payment_info: { method: 'venmo', handle: '  @kai  ' },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(store.Session[0].host_payment_info, { method: 'venmo', handle: '@kai' });
  });
});

test('a diner cannot redirect the table payments to their own handle', async () => {
  // The whole reason this moved server-side: without the guard, anyone holding
  // the claim link could point everyone's Venmo at themselves.
  await withStub(RESTAURANT, async ({ env, store }) => {
    const { session } = await newSplit({ env });
    await settings(env, req(), {
      session_id: session.id, host_key: 'guessed',
      host_payment_info: { method: 'venmo', handle: '@thief' },
    });
    const res = await settings(env, req(), {
      session_id: session.id,
      host_payment_info: { method: 'venmo', handle: '@thief' },
    });
    assert.equal(res.status, 403);
    assert.equal(store.Session[0].host_payment_info, undefined);
  });
});

test('a payment handle has to be a real method and a real handle', async () => {
  await withStub(RESTAURANT, async ({ env }) => {
    const { session, hostKey } = await newSplit({ env });
    const bad = (info) => settings(env, req(), { session_id: session.id, host_key: hostKey, host_payment_info: info });
    assert.equal((await bad({ method: 'bitcoin', handle: 'x' })).status, 400);
    assert.equal((await bad({ method: 'venmo', handle: '   ' })).status, 400);
    assert.equal((await bad({ method: 'venmo' })).status, 400);
  });
});

test('the host can open claiming, and cannot declare the split finished', async () => {
  await withStub(RESTAURANT, async ({ env, store }) => {
    const { session, hostKey } = await newSplit({ env });
    await settings(env, req(), { session_id: session.id, host_key: hostKey, status: 'claiming' });
    assert.equal(store.Session[0].status, 'claiming');

    const res = await settings(env, req(), { session_id: session.id, host_key: hostKey, status: 'completed' });
    assert.equal(res.status, 400, "completing is confirmPayment's job, and only when every diner is settled");
    assert.equal(store.Session[0].status, 'claiming');
  });
});

test('custom amounts are applied to the stored participants, not sent as an array', async () => {
  await withStub(RESTAURANT, async ({ env, store }) => {
    const { session, hostKey } = await newSplit({ env });
    await join(env, { session_id: session.id, participant_id: ALICE, name: 'Alice', items: [] });
    await join(env, { session_id: session.id, participant_id: BOB, name: 'Bob', items: [] });

    const res = await settings(env, req(), {
      session_id: session.id, host_key: hostKey,
      custom_amounts: { [ALICE]: 20, [BOB]: 10 },
    });
    assert.equal(res.status, 200);
    const [alice, bob] = store.Session[0].participants;
    assert.equal(alice.amount_owed, 20);
    assert.equal(bob.amount_owed, 10);
    assert.equal(store.Session[0].split_mode, 'custom');
    assert.equal(alice.payment_status, 'unpaid', 'setting amounts does not touch anyone payment state');
  });
});

test('custom amounts that do not add up to the bill are refused', async () => {
  await withStub(RESTAURANT, async ({ env, store }) => {
    const { session, hostKey } = await newSplit({ env });
    await join(env, { session_id: session.id, participant_id: ALICE, name: 'A', items: [] });
    await join(env, { session_id: session.id, participant_id: BOB, name: 'B', items: [] });

    const res = await settings(env, req(), {
      session_id: session.id, host_key: hostKey,
      custom_amounts: { [ALICE]: 5, [BOB]: 5 },     // the bill is $30
    });
    assert.equal(res.status, 400);
    assert.match((await body(res)).error, /\$10\.00.*\$30\.00/);
    assert.equal(store.Session[0].participants[0].amount_owed, 0, 'nothing was stored');
  });
});

test('a custom split cannot restate what a settled diner already paid', async () => {
  await withStub(RESTAURANT, async ({ env, store }) => {
    const { session, hostKey } = await newSplit({ env });
    await join(env, { session_id: session.id, participant_id: ALICE, name: 'Alice', items: [{ id: 'i1', claimed_by: [ALICE] }] });
    await join(env, { session_id: session.id, participant_id: BOB, name: 'Bob', items: [{ id: 'i2', claimed_by: [BOB] }] });
    await confirm(env, req(), { session_id: session.id, participant_id: ALICE, host_key: hostKey });

    // Alice is settled at $20. Trying to move her is refused by name, rather
    // than surfacing as arithmetic the host cannot make sense of.
    const refused = await settings(env, req(), {
      session_id: session.id, host_key: hostKey,
      custom_amounts: { [ALICE]: 5, [BOB]: 25 },
    });
    assert.equal(refused.status, 409);
    assert.match((await body(refused)).error, /Alice already paid/);
    assert.equal(store.Session[0].participants[0].amount_owed, 20, 'frozen');

    // Leaving her where she is, the rest of the bill is the host's to move.
    const ok = await settings(env, req(), {
      session_id: session.id, host_key: hostKey,
      custom_amounts: { [ALICE]: 20, [BOB]: 10 },
    });
    assert.equal(ok.status, 200);
    const [alice, bob] = store.Session[0].participants;
    assert.equal(alice.amount_owed, 20);
    assert.equal(bob.amount_owed, 10);
  });
});

test('updateSplitSettings validates its inputs', async () => {
  await withStub(RESTAURANT, async ({ env }) => {
    const { session, hostKey } = await newSplit({ env });
    assert.equal((await settings(env, req(), { host_key: hostKey })).status, 400);
    assert.equal((await settings(env, req(), { session_id: 'gone', host_key: hostKey })).status, 404);
    assert.equal((await settings(env, req(), { session_id: session.id, host_key: hostKey })).status, 400, 'nothing to change');
    assert.equal((await settings(env, req(), { session_id: session.id, host_key: hostKey, custom_amounts: 'nope' })).status, 400);
  });
});

test('a guest host can mint the QR code their table needs to scan', async () => {
  await withStub(RESTAURANT, async ({ env }) => {
    const { session, hostKey } = await newSplit({ env });
    const res = await asResponse(HANDLERS.generateQRSignature({
      env, request: req(), body: { session_id: session.id, host_key: hostKey },
    }));
    assert.equal(res.status, 200);
    const { qr_token } = await body(res);

    const check = await HANDLERS.verifyQRToken({ env, body: { qr_token } });
    assert.deepEqual(await body(check), { valid: true, session_id: session.id });
  });
});

test('a wrong host key mints nothing', async () => {
  await withStub(RESTAURANT, async ({ env }) => {
    const { session } = await newSplit({ env });
    const res = await asResponse(HANDLERS.generateQRSignature({
      env, request: req(), body: { session_id: session.id, host_key: 'guessed' },
    }));
    assert.equal(res.status, 403);
  });
});
