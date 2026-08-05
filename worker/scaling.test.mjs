/**
 * What happens when there is more than one table.
 *
 * Every layer before this one asked whether a thing was correct. This one asks
 * what it costs when it runs as often as it is actually going to, and the two
 * places the answer was wrong are both about a number nobody multiplied out:
 *
 *   - getSessionAsHost wrote an audit row per call, and every host screen in
 *     the product polls it every three seconds.
 *   - The nightly backup read every row of every table into one isolate, with
 *     no idea how large that could get before Cloudflare stopped it — and each
 *     of the three limits it would hit was silent.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HANDLERS, onRequestPost } from './routes/functions.js';
import { firstInWindow } from './lib/rate-limit.js';
import { runBackup, ENTITIES } from './routes/nightly-backup.js';
import { scheduled } from './routes/nightly-backup.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const BASE_ENV = {
  DATA_BACKEND: 'supabase',
  SUPABASE_URL: 'https://stub.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
};

// ── A sampler that behaves like Cloudflare's binding ────────────────────────

/** limit N per window, counted per key, with no clock. */
function sampler(limit = 1) {
  const seen = new Map();
  const calls = [];
  return {
    calls,
    async limit({ key }) {
      calls.push(key);
      const n = (seen.get(key) || 0) + 1;
      seen.set(key, n);
      return { success: n <= limit };
    },
  };
}

// ── The polled host endpoint ────────────────────────────────────────────────

const HOST_KEY = 'hostsecret';

async function hashOf(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function stubSession(session) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const table = new URL(url).pathname.replace('/rest/v1/', '').split('?')[0];
    if (table === 'sessions') return new Response(JSON.stringify([structuredClone(session)]));
    return new Response('[]');
  };
  return () => { globalThis.fetch = original; };
}

/** Drives the host endpoint the way useLiveSplit does, and counts audit rows. */
async function pollAsHost({ env, times, hostKey = HOST_KEY }) {
  const session = {
    id: 's1',
    status: 'claiming',
    restaurant_id: 'r1',
    participants: [],
    items: [],
    host_key_hash: await hashOf(HOST_KEY),
  };
  const restore = stubSession(session);
  const rows = [];
  const audit = async (entry) => { rows.push(entry); };
  try {
    for (let i = 0; i < times; i += 1) {
      try {
        await HANDLERS.getSessionAsHost({
          env,
          request: new Request('https://billtap.app/api/fn/getSessionAsHost', { method: 'POST' }),
          body: { session_id: 's1', host_key: hostKey },
          audit,
        });
      } catch {
        // A rejected host key throws. The audit row is what this counts.
      }
    }
  } finally {
    restore();
  }
  return rows;
}

test('a host screen polling all evening does not write an audit row per poll', async () => {
  // useLiveSplit polls this every 3 seconds — 20 calls a minute, for as long as
  // the host leaves the page up, which is the whole meal. Unguarded that is
  // 1,800 rows for one table over ninety minutes, into a table with no delete
  // path and no retention sweep, every row saying the host looked at their own
  // bill. A twenty-table Saturday is thirty-six thousand of them from one venue.
  const env = { ...BASE_ENV, AUDIT_SAMPLER: sampler(1) };
  const rows = await pollAsHost({ env, times: 20 });

  assert.equal(rows.length, 1, `20 polls wrote ${rows.length} audit rows`);
  assert.equal(rows[0].action, 'split.host_access');
});

test('the first read of a screen is still recorded immediately', async () => {
  // Coalescing must not mean "recorded a minute late". Opening the screen is
  // the access; if that one is dropped the log answers nothing.
  const env = { ...BASE_ENV, AUDIT_SAMPLER: sampler(1) };
  const rows = await pollAsHost({ env, times: 1 });
  assert.equal(rows.length, 1);
});

test('a rejected host key is recorded every single time', async () => {
  // The security event, and nothing polls with a wrong key. Coalescing this
  // would turn a brute-force attempt into one row a minute.
  const env = { ...BASE_ENV, AUDIT_SAMPLER: sampler(1) };
  const rows = await pollAsHost({ env, times: 5, hostKey: 'wrong' });

  assert.equal(rows.length, 5, 'rejections were coalesced');
  for (const row of rows) assert.equal(row.action, 'host_key.rejected');
});

test('an unbound or broken sampler writes the row rather than losing it', async () => {
  // Deliberate direction. Extra rows are noise and noise can be filtered; a
  // missing row is evidence that no longer exists, and the audit log is what a
  // payment dispute is settled from.
  const unbound = await pollAsHost({ env: { ...BASE_ENV }, times: 3 });
  assert.equal(unbound.length, 3, 'rows were dropped when no sampler was bound');

  const broken = {
    ...BASE_ENV,
    AUDIT_SAMPLER: { async limit() { throw new Error('binding unavailable'); } },
  };
  assert.equal((await pollAsHost({ env: broken, times: 3 })).length, 3);
});

test('firstInWindow keys per split, so one table cannot silence another', async () => {
  const env = { AUDIT_SAMPLER: sampler(1) };
  assert.equal(await firstInWindow(env, 'host-access:s1'), true);
  assert.equal(await firstInWindow(env, 'host-access:s1'), false);
  assert.equal(await firstInWindow(env, 'host-access:s2'), true, 'a second split shares a bucket');
});

test('the sampler window is not slower than the poll it exists to absorb', () => {
  // If someone widens FAST_MS to a minute, this coalescer stops earning its
  // place; if someone narrows the sampler period below the poll, it stops
  // working. Neither is wrong on its own, and both are worth noticing.
  const hook = readFileSync(join(ROOT, 'src/hooks/useLiveSplit.js'), 'utf8');
  const fast = Number(/const FAST_MS = (\d+)/.exec(hook)[1]);
  assert.ok(fast > 0 && fast <= 10000, `FAST_MS is ${fast}ms`);

  const wrangler = readFileSync(join(ROOT, 'wrangler.jsonc'), 'utf8');
  const periods = [...wrangler.matchAll(/"AUDIT_SAMPLER"[\s\S]{0,200}?"period":\s*(\d+)/g)]
    .map((m) => Number(m[1]));
  assert.ok(periods.length >= 3, 'AUDIT_SAMPLER must be declared on every environment');
  for (const period of periods) {
    assert.ok(period * 1000 > fast, `a ${period}s window does not coalesce a ${fast}ms poll`);
  }
});

test('every environment gets its own sampler namespace', () => {
  // Sharing one would let a staging host screen coalesce a real restaurant's
  // audit rows away — the same argument as the two rate-limit namespaces.
  const wrangler = readFileSync(join(ROOT, 'wrangler.jsonc'), 'utf8');
  const namespaces = [...wrangler.matchAll(/"AUDIT_SAMPLER"[\s\S]{0,200}?"namespace_id":\s*"(\d+)"/g)]
    .map((m) => m[1]);
  assert.equal(namespaces.length, 3, `expected three AUDIT_SAMPLER bindings, got ${namespaces.length}`);
  assert.equal(new Set(namespaces).size, 3, `namespaces are shared: ${namespaces}`);

  // And not shared with the request limiters either.
  const others = [...wrangler.matchAll(/"API_RATE_LIMITER(?:_COSTLY)?"[\s\S]{0,200}?"namespace_id":\s*"(\d+)"/g)]
    .map((m) => m[1]);
  for (const ns of namespaces) {
    assert.ok(!others.includes(ns), `namespace ${ns} is also a request limiter`);
  }
});

// ── The polled read, which is where the traffic actually is ─────────────────

/** One call to the host read, optionally conditional. */
async function readAsHost({ session, ifNoneMatch = null }) {
  const restore = stubSession(session);
  try {
    const headers = ifNoneMatch ? { 'If-None-Match': ifNoneMatch } : {};
    return await HANDLERS.getSessionAsHost({
      env: BASE_ENV,
      request: new Request('https://billtap.app/api/fn/getSessionAsHost', { method: 'POST', headers }),
      body: { session_id: 's1', host_key: HOST_KEY },
      audit: async () => {},
    });
  } finally { restore(); }
}

async function hostSession(extra = {}) {
  return {
    id: 's1',
    status: 'claiming',
    restaurant_id: 'r1',
    total_amount: 60,
    participants: [{ participant_id: 'p_1_a', name: 'Alice', payment_status: 'unpaid', amount_owed: 30 }],
    items: [{ id: 'i1', name: 'Steak', price: 60, quantity: 1, claimed_by: [] }],
    host_key_hash: await hashOf(HOST_KEY),
    ...extra,
  };
}

test('an unchanged split answers the next poll with no body at all', async () => {
  // Six phones at a table, twenty calls a minute each, for the length of a
  // meal, about a split that changes a handful of times. The whole session —
  // every item, every claim, every participant — was sent, parsed and then
  // discarded by the client's own fingerprint on nearly every one of them.
  const session = await hostSession();
  const first = await readAsHost({ session });
  assert.equal(first.status, 200);
  const etag = first.headers.get('ETag');
  assert.ok(etag, 'no ETag, so a client has nothing to send back');

  const second = await readAsHost({ session, ifNoneMatch: etag });
  assert.equal(second.status, 304);
  assert.equal(await second.text(), '', 'a 304 must not carry a body');
  assert.equal(second.headers.get('ETag'), etag);
});

test('anything a diner could see change produces a new tag', async () => {
  // The safety argument for the whole mechanism: the hash is over the exact
  // bytes that would have been sent, so "same tag" means "byte-identical
  // response". If this ever stops being true, a table watches a stale total.
  const base = await hostSession();
  const etag = (await readAsHost({ session: base })).headers.get('ETag');

  const changes = {
    'a diner settling up': (s) => { s.participants[0].payment_status = 'paid'; },
    'an item being claimed': (s) => { s.items[0].claimed_by = ['p_1_a']; },
    'someone joining': (s) => {
      s.participants.push({ participant_id: 'p_2_b', name: 'Bob', payment_status: 'unpaid', amount_owed: 30 });
    },
    'the split completing': (s) => { s.status = 'completed'; },
    'the amount owed moving': (s) => { s.participants[0].amount_owed = 45; },
    'the total being corrected': (s) => { s.total_amount = 75; },
  };

  for (const [what, mutate] of Object.entries(changes)) {
    const session = await hostSession();
    mutate(session);
    const res = await readAsHost({ session, ifNoneMatch: etag });
    assert.equal(res.status, 200, `${what} was answered with a 304`);
    assert.notEqual(res.headers.get('ETag'), etag, `${what} did not change the tag`);
  }
});

test('a stale tag is answered in full, not refused', async () => {
  // A tag from a previous deploy, or a client that kept one across a restart.
  // It must simply not match.
  const session = await hostSession();
  const res = await readAsHost({ session, ifNoneMatch: '"not-a-real-tag"' });
  assert.equal(res.status, 200);
  assert.ok((await res.text()).includes('s1'));
});

test('the polled reads are the only endpoints that answer 304', async () => {
  // Everything else here is a mutation or a one-shot read. A conditional
  // response from a write would be a correctness bug, not an optimisation.
  const source = readFileSync(join(ROOT, 'worker/routes/functions.js'), 'utf8');
  const users = [...source.matchAll(/^\s*return etagJson\(/gm)];
  assert.equal(users.length, 2, `etagJson has ${users.length} call sites, expected the two polled reads`);

  for (const name of ['getSplitStatus', 'getSessionAsHost']) {
    const start = source.indexOf(`async ${name}(`);
    assert.ok(start > 0, `${name} not found`);
    const body = source.slice(start, source.indexOf('\n  async ', start + 10));
    assert.match(body, /return etagJson\(request,/, `${name} is polled but sends a full body every time`);
  }
});

test('a 304 survives the dispatcher that stamps every response', async () => {
  // onRequestPost rebuilds every handler response to add X-Request-Id:
  // `new Response(response.body, { status, headers })`. That constructor throws
  // on a 304 with a body, so the wrapper is where a conditional response would
  // break if the handler ever returned one — and the handler-level tests above
  // would not have noticed, because they never go through it.
  const session = await hostSession();
  const restore = stubSession(session);
  try {
    const call = (headers = {}) => onRequestPost({
      request: new Request('https://billtap.app/api/fn/getSessionAsHost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ session_id: 's1', host_key: HOST_KEY }),
      }),
      env: BASE_ENV,
      ctx: { waitUntil() {} },
      name: 'getSessionAsHost',
    });

    const first = await call();
    assert.equal(first.status, 200);
    const etag = first.headers.get('ETag');

    const second = await call({ 'If-None-Match': etag });
    assert.equal(second.status, 304);
    assert.ok(second.headers.get('X-Request-Id'), 'the request id is dropped on the 304 path');
  } finally { restore(); }
});

test('the two scoped views of one split do not share a tag', async () => {
  // getSplitStatus scopes to the caller — only their own amount_owed — so the
  // hash has to be of the scoped body. Hashing the row would mean a diner whose
  // own share moved being told nothing had changed.
  const session = await hostSession();
  const restore = stubSession(session);
  try {
    const req = (headers = {}) => new Request('https://billtap.app/api/fn/getSplitStatus', { method: 'POST', headers });
    const guest = await HANDLERS.getSplitStatus({ env: BASE_ENV, request: req(), body: { session_id: 's1' } });
    const host = await readAsHost({ session });
    assert.notEqual(
      guest.headers.get('ETag'),
      host.headers.get('ETag'),
      'the guest and host views hash the same, so one could be served the other\'s 304',
    );
  } finally { restore(); }
});

// ── The one ceiling a restaurant can reach by succeeding ────────────────────

test('hitting the guest-split cap is logged, not just refused', async () => {
  // A hundred splits in an hour is either somebody scripting the endpoint or a
  // full room on a Saturday, and from outside the two are identical. It
  // returned a 429 and recorded nothing anywhere, so the second case is a
  // restaurant watching diners fail to start splits with no indication that a
  // ceiling exists.
  const now = new Date().toISOString();
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const table = new URL(url).pathname.replace('/rest/v1/', '').split('?')[0];
    if (table === 'restaurants') return new Response(JSON.stringify([{ id: 'r1', slug: 'olive' }]));
    if (table === 'sessions') {
      return new Response(JSON.stringify(
        Array.from({ length: 101 }, (_, i) => ({ id: `s${i}`, created_date: now })),
      ));
    }
    return new Response('[]');
  };

  const warnings = [];
  const warn = console.warn;
  console.warn = (line) => warnings.push(String(line));

  try {
    const res = await HANDLERS.createSession({
      env: BASE_ENV,
      request: new Request('https://billtap.app/api/fn/createSession', { method: 'POST' }),
      body: {
        // A diner who scanned a table tent — the whole reason this endpoint
        // takes no credentials, and therefore the caller the cap is about.
        restaurant_slug: 'olive',
        title: 'Dinner',
        split_mode: 'even',
        total_amount: 40,
        items: [],
      },
    });
    assert.equal(res.status, 429);
  } finally {
    console.warn = warn;
    globalThis.fetch = original;
  }

  const line = warnings.find((l) => l.includes('guest_session_cap'));
  assert.ok(line, `the cap was hit and nothing was logged: ${JSON.stringify(warnings)}`);
  assert.match(line, /r1/, 'the log must name the restaurant that hit it');
});

// ── The nightly backup ──────────────────────────────────────────────────────

/**
 * A database of a given size behind the PostgREST paging the backup does, plus
 * an R2 bucket that records what was written.
 */
function stubBackup({ rowsPerEntity = 1, rowBytes = 10, failEntity = null } = {}) {
  const reads = [];
  const original = globalThis.fetch;
  const filler = 'x'.repeat(rowBytes);

  globalThis.fetch = async (url) => {
    const u = new URL(url);
    const table = u.pathname.replace('/rest/v1/', '').split('?')[0];
    reads.push(table);
    if (failEntity && table === failEntity) return new Response('boom', { status: 500 });

    const limit = Number(u.searchParams.get('limit') || 200);
    const offset = Number(u.searchParams.get('offset') || 0);
    const remaining = Math.max(0, rowsPerEntity - offset);
    const n = Math.min(limit, remaining);
    const rows = Array.from({ length: n }, (_, i) => ({ id: `${table}-${offset + i}`, filler }));
    return new Response(JSON.stringify(rows));
  };

  const written = new Map();
  const BACKUP_BUCKET = {
    async put(key, body, options) { written.set(key, { body, options }); },
    async head(key) { return written.has(key) ? { size: written.get(key).body.length } : null; },
  };

  return { reads, written, BACKUP_BUCKET, restore: () => { globalThis.fetch = original; } };
}

test('each entity is written as its own object, not one snapshot of everything', async () => {
  // It held every row of all eight entities in one object and then serialised
  // it alongside — peak memory roughly twice the database, in an isolate with
  // 128 MB. Separate objects make the peak the largest single entity.
  const stub = stubBackup({ rowsPerEntity: 3 });
  try {
    const result = await runBackup({ ...BASE_ENV, BACKUP_BUCKET: stub.BACKUP_BUCKET });
    assert.equal(result.failed.length, 0, JSON.stringify(result.entities));
    assert.equal(result.objects.length, ENTITIES.length);
    for (const name of ENTITIES) {
      assert.ok(
        [...stub.written.keys()].some((k) => k.endsWith(`/${name}.json`)),
        `${name} has no object of its own`,
      );
    }
  } finally { stub.restore(); }
});

test('the manifest says whether the backup is complete', async () => {
  const stub = stubBackup({ rowsPerEntity: 2, failEntity: 'sessions' });
  try {
    const result = await runBackup({ ...BASE_ENV, BACKUP_BUCKET: stub.BACKUP_BUCKET });
    const manifest = JSON.parse(stub.written.get(result.key).body);
    assert.equal(manifest.complete, false);
    assert.ok(manifest.failed.includes('Session'), `failed: ${manifest.failed}`);
    // The rest still landed — a backup missing one table beats no backup.
    assert.ok(manifest.objects.length >= ENTITIES.length - 1);
  } finally { stub.restore(); }
});

test('a partial backup fails the invocation instead of reporting success', async () => {
  // It logged the failed entities with console.error and returned normally, so
  // the cron was marked successful. The object is there, its size is plausible,
  // its timestamp is last night, and tables are missing from it — and nobody
  // finds out until they are restoring.
  const stub = stubBackup({ rowsPerEntity: 2, failEntity: 'sessions' });
  const env = {
    ...BASE_ENV,
    ENVIRONMENT: 'production',
    BACKUP_BUCKET: stub.BACKUP_BUCKET,
  };
  try {
    await assert.rejects(
      () => scheduled(env),
      (error) => {
        assert.match(String(error.message), /Session/);
        return true;
      },
    );
  } finally { stub.restore(); }
});

test('a table past the paging cap is an error, not a silent truncation', async () => {
  // MAX_PAGES simply ended the loop, so a table over 40,000 rows was backed up
  // as its most recent 40,000 — the exact failure this file's header says it
  // was rewritten to prevent, reintroduced one level down.
  const stub = stubBackup({ rowsPerEntity: 10 ** 7 });
  try {
    const result = await runBackup({ ...BASE_ENV, BACKUP_BUCKET: stub.BACKUP_BUCKET });
    const first = Object.values(result.entities)[0];
    assert.match(String(first), /FAILED/, 'paging stopped short and said nothing');
    assert.match(String(first), /rows/);
  } finally { stub.restore(); }
});

test('the run stops before Cloudflare stops it', async () => {
  // A Worker invocation gets 1,000 subrequests for everything it does. Eight
  // entities at up to 200 pages each is 1,600 reads, so past roughly a thousand
  // pages Cloudflare starts refusing — and the per-entity catch turned that
  // into "FAILED" against a run that still wrote an object and returned 200.
  const stub = stubBackup({ rowsPerEntity: 10 ** 7 });
  try {
    const result = await runBackup({ ...BASE_ENV, BACKUP_BUCKET: stub.BACKUP_BUCKET });
    assert.ok(result.reads <= 1000, `the run made ${result.reads} reads before stopping`);
    assert.ok(
      Object.values(result.entities).some((v) => /budget/.test(String(v))),
      `no entity reported the budget stopping it: ${JSON.stringify(result.entities)}`,
    );
  } finally { stub.restore(); }
});

test('an entity too large to serialise is an error, not a dead isolate', async () => {
  // An isolate that runs out of memory is killed with no error and no object.
  // A ceiling that throws at least names the table.
  const stub = stubBackup({ rowsPerEntity: 200, rowBytes: 300_000 });
  try {
    const result = await runBackup({ ...BASE_ENV, BACKUP_BUCKET: stub.BACKUP_BUCKET });
    assert.ok(
      Object.values(result.entities).some((v) => /ceiling|bytes/.test(String(v))),
      `nothing reported the size ceiling: ${JSON.stringify(result.entities)}`,
    );
  } finally { stub.restore(); }
});

test('the backup still refuses to run without a bucket', async () => {
  // Unchanged, and worth keeping asserted: an unconfigured backup has to be
  // loud, because the failure being designed against is one that reports
  // success and stores nothing.
  await assert.rejects(() => runBackup({ ...BASE_ENV }), /BACKUP_BUCKET is not bound/);
});
