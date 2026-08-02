/**
 * The audit trail.
 *
 * The table exists to settle arguments between two people about money, weeks
 * after the meal. That gives it two properties that are easy to state and easy
 * to lose, and both are tested here.
 *
 * **It must not be able to break what it records.** A failed audit write that
 * fails a payment confirmation is strictly worse than no audit trail, and it
 * will happen at the busiest table on the busiest night.
 *
 * **It must not store the secrets it is describing.** The host key authorises
 * confirming payments. Writing it into a table whose whole purpose is to be
 * read back later would hand anyone with read access the ability to settle
 * other people's bills.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { auditRow, audit, safeDetail, fingerprint, ACTIONS } from './lib/audit.js';
import { HANDLERS } from './routes/functions.js';

const req = (headers = {}) =>
  new Request('https://billtap.app/api/fn/confirmPayment', { method: 'POST', headers });

/**
 * Captures the structured lines these functions emit by design.
 *
 * Awaits `fn` rather than returning its promise. Restoring the console
 * synchronously would put it back before an async body had logged anything —
 * which does not fail loudly, it just quietly collects nothing, and every
 * assertion of the form "the key is not in the output" then passes against an
 * empty array.
 */
async function quiet(fn) {
  const log = console.log;
  const error = console.error;
  const lines = [];
  console.log = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  try {
    return await fn(lines);
  } finally {
    console.log = log;
    console.error = error;
  }
}

// ── The secret must not be in the row ───────────────────────────────────────

test('the host key is never stored, only a fingerprint of it', async () => {
  const key = 'IqL8Zt3vQm1XsPd7Ry0Kn4Bw';
  const row = await auditRow({
    action: ACTIONS.PAYMENT_CONFIRMED,
    request: req(),
    sessionId: 's1',
    actorHostKey: key,
  });

  const text = JSON.stringify(row);
  assert.ok(!text.includes(key), 'the host key authorises confirming payments — it cannot live in a table meant to be read');
  assert.match(row.actor_host_key_fp, /^[0-9a-f]{12}$/);
});

test('two hosts are distinguishable, and the same host is recognisable', async () => {
  // Both halves are needed. Without stability you cannot say "the same host
  // did all four of these"; without distinctness the column says nothing.
  const a = await fingerprint('host-key-one');
  const b = await fingerprint('host-key-two');
  assert.notEqual(a, b);
  assert.equal(a, await fingerprint('host-key-one'));
});

test('the source address is fingerprinted, not stored', async () => {
  const row = await auditRow({
    action: ACTIONS.SPLIT_CREATED,
    request: req({ 'CF-Connecting-IP': '203.0.113.44' }),
  });
  assert.ok(!JSON.stringify(row).includes('203.0.113.44'));
  assert.match(row.source_ip_fp, /^[0-9a-f]{12}$/);
});

test('a missing value fingerprints to null rather than to a constant', async () => {
  // Hashing the empty string would give every anonymous row one shared
  // fingerprint, which reads as "the same actor did all of these".
  assert.equal(await fingerprint(null), null);
  assert.equal(await fingerprint(''), null);
});

// ── Detail is an allow-list, and that is deliberate ─────────────────────────

test('a field nobody listed is dropped, not redacted', async () => {
  // Redaction fails open: the day somebody adds `guest_note` it goes straight
  // into the table and nobody finds out until it is read back.
  const out = safeDetail({ amount: 23.4, guest_email: 'alice@example.com', note: 'told me her card was declined' });
  assert.deepEqual(out, { amount: 23.4 });
});

test('the amount survives, because without it the row cannot settle a dispute', async () => {
  const out = safeDetail({ amount: 23.4, previous_amount: 19 });
  assert.equal(out.amount, 23.4);
  assert.equal(out.previous_amount, 19);
});

test('a nested object is dropped even under an allowed key', async () => {
  // An allowed name is not a promise about the shape. `status: {...}` would put
  // an arbitrary object into the trail through a key that passed the check.
  assert.deepEqual(safeDetail({ status: { secret: 'x' } }), {});
});

test('a long string is capped rather than stored whole', async () => {
  const out = safeDetail({ reason: 'x'.repeat(500) });
  assert.equal(out.reason.length, 120);
});

// ── Three identities, kept apart ────────────────────────────────────────────

test('a browser-supplied participant id is recorded as a claim, not as an actor', async () => {
  const row = await auditRow({
    action: ACTIONS.PAYMENT_SELF_REPORTED,
    request: req(),
    actorParticipantId: 'p_1700000000_ab12cd',
  });
  // Nobody verified this. The column name says so, and a row that implied
  // otherwise would make the whole table evidence of nothing.
  assert.equal(row.actor_participant_claim, 'p_1700000000_ab12cd');
  assert.equal(row.actor_user_id, null);
  assert.equal(row.actor_host_key_fp, null);
});

test('a verified user id and a verified host key are separate columns', async () => {
  const row = await auditRow({
    action: ACTIONS.SPLIT_CREATED,
    request: req(),
    actorUserId: 'a3f1c2d4-0000-4000-8000-000000000000',
    actorHostKey: 'somekey',
  });
  assert.equal(row.actor_user_id, 'a3f1c2d4-0000-4000-8000-000000000000');
  assert.match(row.actor_host_key_fp, /^[0-9a-f]{12}$/);
});

// ── It must never break the action it records ───────────────────────────────

test('a database that refuses the write does not fail the caller', async () => {
  await quiet(async () => {
    const env = { SUPABASE_URL: 'https://p.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' };
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response('permission denied for table audit_log', { status: 403 });
    try {
      await assert.doesNotReject(() =>
        audit(env, null, { action: ACTIONS.PAYMENT_CONFIRMED, request: req(), sessionId: 's1' }));
    } finally {
      globalThis.fetch = original;
    }
  });
});

test('a network failure does not fail the caller either', async () => {
  await quiet(async () => {
    const env = { SUPABASE_URL: 'https://p.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' };
    const original = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('connect ETIMEDOUT'); };
    try {
      await assert.doesNotReject(() => audit(env, null, { action: ACTIONS.PAYMENT_CONFIRMED, request: req() }));
    } finally {
      globalThis.fetch = original;
    }
  });
});

test('an unconfigured database is not an error, it is the migration not being finished', async () => {
  await quiet(async () => {
    let called = false;
    const original = globalThis.fetch;
    globalThis.fetch = async () => { called = true; return new Response('', { status: 201 }); };
    try {
      await audit({}, null, { action: ACTIONS.SPLIT_CREATED, request: req() });
      assert.equal(called, false, 'nothing to write to yet, and that must not break every function in the app');
    } finally {
      globalThis.fetch = original;
    }
  });
});

test('a row that cannot even be built is swallowed', async () => {
  await quiet(async () => {
    // A request object that throws when read. Nothing should escape.
    const hostile = { headers: { get() { throw new Error('nope'); } } };
    await assert.doesNotReject(() => audit({}, null, { action: 'x', request: hostile }));
  });
});

test('the write goes through waitUntil when there is one, so nobody waits on it', async () => {
  await quiet(async () => {
    const deferred = [];
    const env = { SUPABASE_URL: 'https://p.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' };
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response('', { status: 201 });
    try {
      await audit(env, { waitUntil: (p) => deferred.push(p) }, { action: ACTIONS.SPLIT_CREATED, request: req() });
      assert.equal(deferred.length, 1);
      await Promise.all(deferred);
    } finally {
      globalThis.fetch = original;
    }
  });
});

test('a line is emitted even when the table write is impossible', async () => {
  // Cloudflare's retention is short and the database is the durable home, but a
  // structured line is the only record that survives the database being the
  // thing that broke.
  await quiet(async (lines) => {
    await audit({}, null, { action: ACTIONS.PAYMENT_CONFIRMED, request: req(), sessionId: 's1' });
    const line = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((l) => l?.audit);
    assert.ok(line, 'the action must be recorded somewhere');
    assert.equal(line.action, ACTIONS.PAYMENT_CONFIRMED);
    assert.equal(line.session_id, 's1');
  });
});

test('the service role key is not in the line that gets logged', async () => {
  await quiet(async (lines) => {
    const env = { SUPABASE_URL: 'https://p.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sk_live_do_not_log_me' };
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response('', { status: 201 });
    try {
      await audit(env, null, { action: ACTIONS.SPLIT_CREATED, request: req() });
      assert.ok(!lines.join('\n').includes('sk_live_do_not_log_me'));
    } finally {
      globalThis.fetch = original;
    }
  });
});

// ── The handlers actually record ────────────────────────────────────────────

test('a rejected host key is recorded, and recorded as denied', async () => {
  // The signature of somebody trying to settle a bill that is not theirs. It is
  // the one failure in this app worth being able to count.
  const seen = [];
  const env = {
    BASE44_APP_ID: 'x',
    BASE44_MASTER_KEY: 'm',
  };
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/entities/Session')) {
      return new Response(JSON.stringify([{ id: 's1', host_key_hash: 'nomatch', participants: [], restaurant_id: 'r1' }]), { status: 200 });
    }
    return new Response('[]', { status: 200 });
  };
  try {
    await assert.rejects(() => HANDLERS.confirmPayment({
      env,
      request: req(),
      body: { session_id: 's1', participant_id: 'p_1700000000_ab12cd', host_key: 'guessed' },
      audit: async (entry) => seen.push(entry),
    }), /Only the host/);
  } finally {
    globalThis.fetch = original;
  }

  assert.equal(seen.length, 1);
  assert.equal(seen[0].action, ACTIONS.HOST_KEY_REJECTED);
  assert.equal(seen[0].outcome, 'denied');
  assert.equal(seen[0].sessionId, 's1');
});

test('a handler called without the hook still does its job', async () => {
  // Same rule as the swallowed failure above, at the call boundary: recording
  // an action must never be the thing that breaks it.
  const res = await HANDLERS.validateReceiptParse({ body: { items: [], total: 0 } });
  assert.equal(res.status, 200);
});
