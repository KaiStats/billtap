/**
 * Whether this thing can be brought back.
 *
 * The three assets that matter during an outage are a way to tell if it is
 * down, a way to undo the last change, and a document that tells the truth
 * about both. This layer found the first missing, the second undocumented, and
 * the third describing a system that has not been in the request path for
 * months — thirteen references to Base44, a named AI function that calls no AI,
 * the wrong provider's status page, and a "manual mode" fallback that has never
 * existed, while the fallback that does exist went unmentioned.
 *
 * A runbook is read once, under pressure, and believed. So the parts of it that
 * name code are checked against the code here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { onRequestGet as health } from './routes/health.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const runbook = read('src/RUNBOOK.md');

/**
 * The runbook with its block quotes removed.
 *
 * `>` is this document's convention for "here is what this section used to say
 * and why it was wrong", so those lines quote the very strings the assertions
 * below ban — `status.openai.com` among them, which tripped this test the first
 * time it ran. Same shape as the sign-out keys, the CSP handler, the CI timeout
 * and the sourcemap comment: documenting a hazard trips the guard against it.
 * Fifth time, and the fix is the same one every time.
 */
const instructions = runbook.split('\n').filter((line) => !/^\s*>/.test(line)).join('\n');
const pkg = JSON.parse(read('package.json'));

const ENV = {
  DATA_BACKEND: 'supabase',
  ENVIRONMENT: 'production',
  SUPABASE_URL: 'https://stub.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
};

const get = (query = '') =>
  health({ request: new Request(`https://billtap.app/api/health${query}`), env: ENV });

// ── Something to point a monitor at ─────────────────────────────────────────

test('a healthy deployment answers 200', async () => {
  const res = await get();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.environment, 'production');
  assert.equal(body.backend, 'supabase');
});

test('the status code carries the answer, not the body', async () => {
  // A monitor that has to parse a body to learn something is wrong is one
  // somebody configures once, incorrectly, and trusts for a year.
  const res = await health({
    request: new Request('https://billtap.app/api/health'),
    env: { DATA_BACKEND: 'supabase', ENVIRONMENT: 'production' },
  });
  assert.equal(res.status, 503, 'a Worker with no database credentials reported healthy');
  assert.equal((await res.json()).ok, false);
});

test('the shallow check costs no subrequests', async () => {
  // What makes it safe to poll every thirty seconds forever. A health check
  // that queries the database is a health check that adds load in exactly the
  // conditions it exists to detect.
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (...args) => { calls.push(args[0]); return new Response('[]'); };
  try {
    await get();
    assert.equal(calls.length, 0, `the shallow check made ${calls.length} outbound calls`);
  } finally { globalThis.fetch = original; }
});

test('the deep check actually asks the database, and reports a refusal as unhealthy', async () => {
  // A TCP connection proves nothing about whether the service-role key still
  // works, and a rotated key is the failure this is here to catch.
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('[]', { status: 200 });
    const okRes = await get('?deep=1');
    assert.equal(okRes.status, 200);
    assert.equal((await okRes.json()).database.ok, true);

    globalThis.fetch = async () => new Response('{"message":"JWT expired"}', { status: 401 });
    const badRes = await get('?deep=1');
    assert.equal(badRes.status, 503);
    const body = await badRes.json();
    assert.equal(body.database.ok, false);
    assert.equal(body.database.status, 401);
  } finally { globalThis.fetch = original; }
});

test('an unreachable database is 503 rather than a thrown 500', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('connect ETIMEDOUT 1.2.3.4:443'); };
  try {
    const res = await get('?deep=1');
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.database.reason, 'unreachable');
    // And not the message, which names a host.
    assert.doesNotMatch(JSON.stringify(body), /ETIMEDOUT|1\.2\.3\.4/);
  } finally { globalThis.fetch = original; }
});

test('a public health check leaks no configuration', async () => {
  // It is unauthenticated on purpose — one behind a credential is one a monitor
  // cannot use and an operator cannot curl from a phone — which makes it a
  // place where a project ref, a tenant id or an upstream error message gets
  // published to a status page nobody thought was sensitive.
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('{"message":"relation \\"sessions\\" does not exist"}', { status: 400 });
  try {
    const body = await (await get('?deep=1')).text();
    for (const secret of ['stub.supabase.co', 'service-key', 'sessions', 'relation']) {
      assert.ok(!body.includes(secret), `the health response contains ${secret}`);
    }
  } finally { globalThis.fetch = original; }
});

test('health responses are never cached', async () => {
  // A cached health check reports on whenever the cache was filled, which is
  // the one moment it is guaranteed not to be about.
  assert.equal((await get()).headers.get('Cache-Control'), 'no-store');
});

// ── A way to undo the last change ───────────────────────────────────────────

test('rolling back is one command, and it is written down', () => {
  assert.ok(pkg.scripts.rollback, 'no rollback script — the fastest fix was undocumented');
  assert.match(pkg.scripts.rollback, /wrangler rollback/);
  assert.ok(pkg.scripts.versions, 'no way to list versions, so no way to pick one');

  assert.match(runbook, /npm run rollback/, 'the runbook never mentions rolling back');
  assert.match(
    runbook,
    /migration/i,
    'a rollback that crosses a database migration needs a warning next to it',
  );
});

test('rollback is the first incident, not a footnote', () => {
  // It is the fastest fix in the system and it was in none of them. Reading
  // logs while a restaurant cannot split bills is how five minutes becomes an
  // hour.
  const first = runbook.indexOf('## Incident 0');
  const others = ['## Incident 1', '## Incident 2', '## Incident 3']
    .map((h) => runbook.indexOf(h));
  assert.ok(first > 0, 'no rollback section');
  for (const at of others) assert.ok(first < at, 'rollback is filed after the slower procedures');
});

// ── A document that tells the truth ─────────────────────────────────────────

test('the runbook does not send an operator to a system we no longer run', () => {
  // Thirteen references, including the Quick Reference table — the one somebody
  // opens first. Base44 is not in the request path and has not been since the
  // cutover; its dashboard holds no logs for anything that runs today.
  // Asserted on instructions, not on mentions. Banning the word outright would
  // fight the paragraphs that explain, accurately, why the backup had to move
  // off Base44 — and a test that punishes honest history gets its exemption
  // list padded until it means nothing. What must not survive is a line that
  // tells somebody to go and do something there.
  const directives = instructions
    .split('\n')
    .filter((line) => /Base44/.test(line))
    .filter((line) => /Dashboard\s*→|\bContact\b|\bCheck\b|\bRotate\b|\bOpen\b|\bpause\b|\bConfirm\b/.test(line));

  assert.deepEqual(
    directives, [],
    `the runbook still sends an operator to Base44:\n${directives.join('\n')}`,
  );
  assert.doesNotMatch(instructions, /app\.base44\.com|support@base44\.com/, 'Base44 support links remain');
  assert.doesNotMatch(instructions, /status\.openai\.com/, 'the provider is Gemini, not OpenAI');
});

test('every code path the runbook names exists', () => {
  // It named `checkSessionRateLimit`, a `cleanupExpiredSessions` automation and
  // a `NewReceipt.jsx` manual mode. None of the three had ever existed in this
  // tree, and each was an instruction somebody would follow during an incident.
  const tree = [
    'worker/routes/scan-receipt.js', 'worker/routes/retention.js',
    'worker/routes/nightly-backup.js', 'worker/lib/rate-limit.js',
    'src/pages/NewReceipt.jsx', 'shared/receipt-math.js',
  ].map(read).join('\n');

  const named = [...runbook.matchAll(/`([a-zA-Z][a-zA-Z0-9_]{4,})`/g)]
    .map((m) => m[1])
    // Identifiers only; the runbook also backticks prose, commands and values.
    .filter((n) => /^[a-z][a-zA-Z0-9]*$/.test(n) && /[A-Z]/.test(n));

  assert.ok(named.length, 'expected the runbook to name some functions');
  for (const name of new Set(named)) {
    assert.ok(
      tree.includes(name),
      `the runbook tells an operator to use \`${name}\`, which exists nowhere in this repo`,
    );
  }
});

test('the runbook points at the health check and the real logs', () => {
  assert.match(runbook, /\/api\/health/, 'the health endpoint is not mentioned');
  assert.match(runbook, /wrangler tail/, 'no way to read the logs that exist');
  assert.match(runbook, /wrangler secret put/, 'no way to rotate the key it tells you to rotate');
});

// ── The degraded path ───────────────────────────────────────────────────────

test('a scan failure offers the path that does not need the model', () => {
  // Reading a receipt is the one step that depends on a third party. A retry is
  // right for a slow network and useless against an outage — it fails again,
  // more slowly, and the table gives up. The even split needs no model and was
  // already on the screen, collapsed behind "Skip setup", unmentioned at the
  // moment it became the only thing that worked.
  const page = read('src/pages/NewReceipt.jsx');
  assert.match(page, /fallback=\{/, 'the error notice offers no way round a provider outage');
  assert.match(page, /Split evenly instead/);
  assert.match(page, /setShowQuickEven\(true\)/, 'the fallback does not open the panel it names');

  // Offered for an upstream failure, not for a rejected file — sending somebody
  // to a different flow because they picked a PDF answers a question they did
  // not ask.
  assert.match(page, /failure\?\.status >= 500/, 'the fallback is offered for client-side rejections too');
});

test('the fallback scrolls after the panel exists, not before', () => {
  // The panel is conditionally rendered, so calling scrollIntoView in the click
  // handler runs against a ref that is still null — a fallback that silently
  // does nothing, which is worse than not offering one.
  const page = read('src/pages/NewReceipt.jsx');
  const handler = page.slice(page.indexOf('Split evenly instead'), page.indexOf('onDismiss={() => setFailure(null)}'));
  assert.doesNotMatch(handler, /scrollIntoView/, 'scrolling from the click handler runs against a null ref');
  assert.match(page, /useEffect\(\(\) => \{\s*\n\s*if \(!showQuickEven/, 'nothing scrolls to the panel after it renders');
});

test('an even split reaches the server without touching the model', () => {
  // The claim the runbook now makes to an operator during an outage. If this
  // ever starts requiring items or a scan, that sentence becomes false.
  const page = read('src/pages/NewReceipt.jsx');
  const quick = page.slice(page.indexOf('const handleQuickEvenCreate'), page.indexOf('const subtotal'));
  assert.match(quick, /invoke\("createSession"/);
  assert.match(quick, /items: \[\]/, 'the even split now needs items, so a scan outage blocks it');
  assert.doesNotMatch(quick, /scan-receipt|readReceipt/, 'the even split now calls the model');
});

// ── Failures that happen when nobody is watching ────────────────────────────

test('a failed cron leaves the Worker rather than dying in a dashboard', () => {
  // The backup throws on purpose, but "the invocation is marked failed" is a
  // number nobody opens at 09:00 — and the moment it matters is Incident 3,
  // where the first question is how old the last good snapshot is. A backup
  // failing for three weeks and one that ran last night look identical.
  const index = read('worker/index.js');
  assert.match(index, /reportError\(env, ctx, error, \{ id: requestId\(\), route: 'cron\/retention' \}\)/);
  assert.match(index, /route: 'cron\/nightly-backup'/);

  // And the backup's own failure must still fail the invocation.
  const backup = index.slice(index.indexOf('nightlyBackup(env)'));
  assert.match(backup.slice(0, 300), /throw error/, 'reporting replaced the rethrow instead of joining it');
});
