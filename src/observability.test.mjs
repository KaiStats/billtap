/**
 * Whether a failure can actually be found afterwards.
 *
 * The app reports errors to Sentry and the Worker writes structured log lines,
 * and both of those were true before this layer without either being much use:
 *
 *   - Every browser stack trace was minified. No sourcemaps were generated, no
 *     plugin uploaded any, and the dependency to do it was not installed. Sentry
 *     was receiving `t.exports.a is not a function` at index-D_aMljtz.js:1:48210
 *     and had been the whole time.
 *   - The Worker's half of an incident lived in Cloudflare's logs, whose
 *     retention is days, while the browser's half lived in Sentry for months.
 *     The half with the money in it expired first.
 *   - One session in ten of everybody was being recorded to a third party by a
 *     bill-splitting app.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/**
 * Comments removed before any structural assertion.
 *
 * This is the fourth time in this audit that documenting a hazard has tripped
 * the test guarding it — the sign-out keys, the CSP handler, the CI timeout,
 * and now the sentence below explaining why `sourcemap: true` is wrong, which
 * contains the string `sourcemap: true`. The prose assertions further down use
 * the raw text on purpose; anything asserting about structure reads this.
 */
const strip = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const viteConfig = strip(read('vite.config.js'));
const main = strip(read('src/main.jsx'));
const replay = read('src/lib/sentry-replay.js');
const pkg = JSON.parse(read('package.json'));

// ── Sourcemaps: the thing that makes a stack trace a stack trace ────────────

test('the build can upload sourcemaps at all', () => {
  assert.ok(
    pkg.devDependencies?.['@sentry/vite-plugin'],
    'nothing in the tree can upload a sourcemap, so every trace stays minified',
  );
  assert.match(viteConfig, /sentryVitePlugin/, 'the plugin is installed but not wired in');
});

test('sourcemaps are hidden, never published', () => {
  // `sourcemap: true` emits the .map files AND a //# sourceMappingURL comment
  // pointing at them, so they are fetched from billtap.app by anyone who opens
  // devtools — this app's entire unminified source, at a guessable URL.
  // 'hidden' emits the files without the comment, for the uploader only.
  assert.doesNotMatch(
    viteConfig,
    /sourcemap:\s*true/,
    "sourcemap: true publishes the app's source; 'hidden' is what uploads without serving",
  );
  assert.match(viteConfig, /sourcemap:.*'hidden'/);
  assert.match(
    viteConfig,
    /filesToDeleteAfterUpload/,
    'the maps must be removed from dist after upload, or hidden only means unadvertised',
  );
});

test('no maps are generated at all without a token', () => {
  // A contributor with no Sentry access has to build exactly what they built
  // before — and must not produce .map files that something else then ships.
  assert.match(
    viteConfig,
    /sourcemap:\s*SENTRY_TOKEN\s*\?/,
    'sourcemap generation must be conditional on the upload being possible',
  );
  assert.match(viteConfig, /SENTRY_TOKEN\s*\n?\s*\?\s*\[sentryVitePlugin|SENTRY_TOKEN$/m);
});

test('the release the client reports is the release the maps are uploaded under', () => {
  // The single most common way sourcemaps look configured and resolve nothing.
  // One expression, used twice — not two expressions expected to agree.
  const decl = /const RELEASE = releaseName\(\)/;
  assert.match(viteConfig, decl, 'the release must be computed once');
  assert.match(
    viteConfig,
    /__SENTRY_RELEASE__:\s*JSON\.stringify\(RELEASE\)/,
    'the client is not given the same release the plugin uploads',
  );
  assert.match(
    viteConfig,
    /release:\s*\{\s*name:\s*RELEASE\s*\}/,
    'the plugin is not told the same release the client reports',
  );
  assert.match(
    main,
    /release:.*__SENTRY_RELEASE__/,
    'Sentry.init does not send a release, so no upload can ever match a frame',
  );
});

// ── Sampling ────────────────────────────────────────────────────────────────

test('a poll loop does not spend the trace quota', () => {
  // browserTracingIntegration turns every fetch into a span, and
  // src/hooks/useLiveSplit calls the Worker every three seconds on every phone
  // at the table. At 1.0 a five-person split is a hundred spans a minute, per
  // table, for the length of a meal, almost all of them the request that says
  // nothing changed.
  const rate = /tracesSampleRate:\s*(.+)/.exec(main)[1];
  assert.doesNotMatch(rate, /^1(\.0)?\s*,/, `tracesSampleRate is ${rate.trim()} in every environment`);
  assert.match(rate, /production/, 'the rate must differ in production, where the tables are');
});

test('diners are not recorded unless something broke', () => {
  // This is a bill-splitting app. A replay is people's names, what they
  // ordered, what they owe and the host's payment handle. Recording a tenth of
  // every table indefinitely, in case one later reports a bug, is not a trade
  // to make silently — and replaysOnErrorSampleRate covers the case anybody has
  // ever actually gone looking for.
  assert.match(
    main,
    /replaysSessionSampleRate:\s*0\s*,/,
    'sessions that never fail are being recorded',
  );
  assert.match(
    main,
    /replaysOnErrorSampleRate:\s*1(\.0)?\s*,/,
    'a session that breaks must still be recorded in full',
  );
});

test('replay masking is written down, not inherited', () => {
  // The defaults are currently right. Nothing in the repo said so, and nothing
  // would notice a version flipping one under a ^8 range.
  for (const option of ['maskAllText', 'maskAllInputs', 'blockAllMedia']) {
    assert.match(
      replay,
      new RegExp(`${option}:\\s*true`),
      `${option} is left to the library default, on a page showing what people owe`,
    );
  }
});

// ── The Worker's half of an incident ────────────────────────────────────────

const { parseDsn, buildEvent, buildEnvelope, reportError } = await import('../worker/lib/report.js');

const DSN = 'https://abc123@o42.ingest.sentry.io/7';

function stubFetch() {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response('{}', { status: 200 });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test('a DSN resolves to the envelope endpoint and its public key', () => {
  const parsed = parseDsn(DSN);
  assert.equal(parsed.key, 'abc123');
  assert.equal(parsed.endpoint, 'https://o42.ingest.sentry.io/api/7/envelope/');
  assert.equal(parseDsn('not a dsn'), null);
  assert.equal(parseDsn(undefined), null);
  assert.equal(parseDsn('https://o42.ingest.sentry.io/7'), null, 'a DSN with no key is not usable');
});

test('the envelope is the three newline-delimited documents Sentry expects', () => {
  const event = buildEvent(new Error('boom'), { id: 'ab12cd', route: 'fn/createSession' });
  const lines = buildEnvelope({ dsn: DSN, event }).split('\n');
  assert.equal(lines.length, 3);
  assert.equal(JSON.parse(lines[0]).dsn, DSN);
  assert.equal(JSON.parse(lines[1]).type, 'event');
  assert.equal(JSON.parse(lines[2]).exception.values[0].value, 'boom');
});

test('the request id a diner reads aloud is a searchable tag', () => {
  // The whole design in worker/lib/errors.js is that six characters on someone's
  // screen lead to one record. A context field would not be searchable.
  const event = buildEvent(new Error('boom'), { id: 'ab12cd', route: 'fn/confirmPayment' });
  assert.equal(event.tags.request_id, 'ab12cd');
  assert.equal(event.tags.route, 'fn/confirmPayment');
  assert.equal(event.transaction, 'fn/confirmPayment');
  assert.equal(event.tags.status, '500');
  assert.match(event.event_id, /^[0-9a-f]{32}$/);
});

test('a report carries no receipt, no headers and no address', () => {
  // This runs while a split is failing, so the request body is a bill with
  // people's names on it. An error reporter must not become a second copy of
  // the data worker/routes/retention.js exists to remove.
  const event = buildEvent(new Error('boom'), { id: 'ab12cd', route: 'fn/createSession' });
  const serialised = JSON.stringify(event);
  for (const field of ['request', 'headers', 'cookies', 'user', 'ip_address', 'participants']) {
    assert.ok(!(field in event), `the event carries a ${field} field`);
  }
  assert.doesNotMatch(serialised, /CF-Connecting-IP|Authorization/i);
});

test('a 4xx is not an incident', async () => {
  // The caller's own mistake, already a log line. Paging on these buries the
  // ones that are ours.
  const stub = stubFetch();
  try {
    const bad = Object.assign(new Error('nope'), { name: 'AppError', status: 400, code: 'invalid_json' });
    assert.equal(reportError({ SENTRY_DSN: DSN }, null, bad, { id: 'a', route: 'r' }), false);
    assert.equal(stub.calls.length, 0);
  } finally { stub.restore(); }
});

test('a 5xx is sent, and off the response path when it can be', async () => {
  const stub = stubFetch();
  const waited = [];
  try {
    const sent = reportError(
      { SENTRY_DSN: DSN, ENVIRONMENT: 'production' },
      { waitUntil: (p) => waited.push(p) },
      new Error('database unreachable'),
      { id: 'ab12cd', route: 'fn/createSession' },
    );
    assert.equal(sent, true);
    assert.equal(waited.length, 1, 'the send is blocking the caller\'s 500');
    await Promise.all(waited);

    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0].url, 'https://o42.ingest.sentry.io/api/7/envelope/');
    assert.match(stub.calls[0].init.headers['X-Sentry-Auth'], /sentry_key=abc123/);
    assert.equal(JSON.parse(stub.calls[0].init.body.split('\n')[2]).environment, 'production');
  } finally { stub.restore(); }
});

test('no DSN is a silent no-op, which is every environment until one is set', async () => {
  const stub = stubFetch();
  try {
    assert.equal(reportError({}, null, new Error('boom'), { id: 'a', route: 'r' }), false);
    assert.equal(reportError({ SENTRY_DSN: 'garbage' }, null, new Error('boom'), { id: 'a', route: 'r' }), false);
    assert.equal(stub.calls.length, 0);
  } finally { stub.restore(); }
});

test('Sentry being down does not become a second incident inside the first', async () => {
  // This module is guaranteed to run while something is already wrong. An
  // unhandled rejection here would surface as an unhandled rejection in the
  // Worker, on the path that was already returning a 500.
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('sentry unreachable'); };
  const waited = [];
  try {
    assert.equal(
      reportError({ SENTRY_DSN: DSN }, { waitUntil: (p) => waited.push(p) }, new Error('boom'), { id: 'a', route: 'r' }),
      true,
    );
    // Must resolve, not reject. An unhandled rejection in waitUntil marks the
    // invocation failed.
    await Promise.all(waited);
  } finally { globalThis.fetch = original; }
});

test('every catch in the Worker hands the reporter what it needs', () => {
  // errorResponse is the single exit for a failure, and it can only report if
  // the call site passes env. One that does not is a 500 that never leaves
  // Cloudflare's log retention — which is the state the whole file was in.
  for (const file of ['worker/index.js', 'worker/routes/functions.js']) {
    const source = strip(read(file));
    // Balanced-paren scan rather than a regex: a non-greedy match stops at the
    // first ')' — inside `new AppError(...)` — and reports a call as broken
    // when it is fine.
    const calls = [];
    for (let i = source.indexOf('errorResponse('); i >= 0; i = source.indexOf('errorResponse(', i + 1)) {
      let depth = 0;
      let j = source.indexOf('(', i);
      for (; j < source.length; j += 1) {
        if (source[j] === '(') depth += 1;
        else if (source[j] === ')') { depth -= 1; if (depth === 0) break; }
      }
      calls.push(source.slice(i, j + 1));
    }
    assert.ok(calls.length, `${file} has no errorResponse calls`);
    for (const call of calls) {
      assert.match(call, /\benv\b/, `an errorResponse in ${file} cannot report: ${call.slice(0, 90)}`);
    }
  }
});
