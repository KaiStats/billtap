/**
 * Calling the app's own functions, and the fact that Base44 is gone.
 *
 * src/api/functions.js is what src/api/base44Client.js became once there was no
 * SDK left underneath it. The contract it has to keep is not obvious from
 * reading it: about twenty call sites destructure res.data, and several depend
 * on a rejection to reach their catch, so resolving with an error object
 * instead of throwing would turn a refused payment into a silent success.
 *
 * The removal tests read the shipped source. That is the right shape for them —
 * the property is that certain modules and dependencies do not exist, and there
 * is nothing to execute to find that out.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const path = (p) => new URL(`../${p}`, import.meta.url).pathname;
const read = (p) => readFileSync(path(p), 'utf8');

/**
 * The module under test imports @/lib/supabase for the access token, which
 * needs a bundler and a browser. Loaded with both stubbed rather than mocked:
 * what these assert is the request that goes out and the value that comes back.
 */
async function loadInvoke({ token = null, response } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return response;
  };
  const { invoke } = await import('./api/functions.js?' + Math.random());
  return { invoke: (name, body, options) => invoke(name, body, options), calls, token };
}

const jsonResponse = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

test('a successful call resolves to { data }, which is what every caller destructures', async () => {
  const { invoke, calls } = await loadInvoke({ response: jsonResponse({ session: { id: 's1' } }) });
  const res = await invoke('getSplitStatus', { session_id: 's1' });
  // `data` is the contract this test is named for, and it is unchanged. The two
  // fields beside it are the conditional-read result — see etagJson() in the
  // Worker — asserted rather than ignored so a caller that starts depending on
  // them finds them described here.
  assert.deepEqual(res.data, { session: { id: 's1' } });
  assert.equal(res.notModified, false, 'a 200 is not a "nothing changed"');
  assert.equal(res.etag, null, 'the response carried no tag, so none is reported');
  assert.equal(calls[0].url, '/api/fn/getSplitStatus');
  assert.equal(calls[0].init.method, 'POST');
});

test('a 304 resolves as "nothing changed" rather than throwing', async () => {
  // The whole risk of the conditional read is one ordering. Response.ok is
  // false for 304, so reaching the error branch would turn every unchanged poll
  // into a rejection — which useLiveSplit counts as a failure and backs off on,
  // doubling its interval up to thirty seconds. A working optimisation would
  // have presented as a flaky network and a split that stopped updating.
  const { invoke } = await loadInvoke({
    response: new Response(null, { status: 304, headers: { ETag: '"abc123"' } }),
  });
  const res = await invoke('getSplitStatus', { session_id: 's1' });
  assert.equal(res.notModified, true);
  assert.equal(res.data, null, 'nothing was sent, so there is nothing to report');
  assert.equal(res.etag, '"abc123"');
});

test('the tag goes back on the next call, and nothing goes when there is none', async () => {
  const { invoke, calls } = await loadInvoke({
    response: jsonResponse({ session: { id: 's1' } }),
  });
  await invoke('getSplitStatus', { session_id: 's1' }, { ifNoneMatch: '"abc123"' });
  assert.equal(calls[0].init.headers['If-None-Match'], '"abc123"');

  await invoke('getSplitStatus', { session_id: 's1' });
  assert.equal(
    calls[1].init.headers['If-None-Match'],
    undefined,
    'a caller holding no tag must not send an empty one',
  );
});

test('a refused call rejects, because several screens catch rather than check', async () => {
  // ReceiptDetail and SessionHost both fall back to the scoped read inside a
  // catch. Resolving here would mean a diner silently getting the host's view
  // of a bill, or a failed payment reported as a successful one.
  const { invoke } = await loadInvoke({
    response: jsonResponse({ error: 'Only the host can change this split.' }, 403),
  });
  await assert.rejects(
    () => invoke('updateSplitSettings', {}),
    (err) => {
      assert.equal(err.status, 403);
      assert.equal(err.message, 'Only the host can change this split.');
      assert.equal(err.data.error, 'Only the host can change this split.');
      return true;
    },
  );
});

test('a failure that is not JSON still rejects with something readable', async () => {
  // Cloudflare's own 1101 page is HTML. Parsing it as JSON throws, and a throw
  // inside the error path used to replace the real failure with a syntax error.
  const { invoke } = await loadInvoke({
    response: new Response('<html>error</html>', { status: 502 }),
  });
  await assert.rejects(() => invoke('createSession', {}), /createSession failed \(502\)/);
});

test('a participant id travels as a header so one table is not one rate-limit bucket', async () => {
  // Six diners on a restaurant's wifi are one IP. Without this the limiter's
  // first act in production is to 429 a paying customer's table.
  const { invoke, calls } = await loadInvoke({ response: jsonResponse({}) });
  await invoke('joinSession', { session_id: 's1', participant_id: 'p_123' });
  assert.equal(calls[0].init.headers['X-BillTap-Participant'], 'p_123');
});

test('a call with no participant id sends no such header', async () => {
  const { invoke, calls } = await loadInvoke({ response: jsonResponse({}) });
  await invoke('getPublicRestaurant', { slug: 'x' });
  assert.ok(!('X-BillTap-Participant' in calls[0].init.headers));
});

test('a guest with no session still gets their call made', async () => {
  // The invariant the whole product rests on. There is no session in this
  // environment, so accessToken() returns null — and nothing may refuse to
  // proceed on that basis. src/auth.test.mjs asserts the same property
  // structurally; this one asserts the request actually goes out.
  const { invoke, calls } = await loadInvoke({ response: jsonResponse({ session: {} }) });
  await invoke('joinSession', { session_id: 's1', participant_id: 'p_1', name: 'Sam' });
  assert.equal(calls.length, 1);
  assert.ok(!('Authorization' in calls[0].init.headers));
});

// ── Base44 is gone ──────────────────────────────────────────────────────────

test('nothing in the app can import the Base44 SDK', () => {
  // Both packages, because the vite plugin was the more dangerous of the two:
  // it injected the builder's analytics tracker and visual edit agent into
  // every page this app served, and aliased @/entities and @/integrations onto
  // the SDK so that removing the dependency alone would not have removed it.
  const pkg = JSON.parse(read('package.json'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const name of Object.keys(deps)) {
    assert.ok(!name.startsWith('@base44/'), `${name} is still a dependency`);
  }
});

test('the modules that spoke to Base44 from the browser no longer exist', () => {
  for (const gone of ['src/api/base44Client.js', 'src/lib/app-params.js', 'worker/routes/base44-proxy.js']) {
    assert.ok(!existsSync(path(gone)), `${gone} is still here`);
  }
});

test('no page imports a Base44 client, by any name', () => {
  // The import is the only way the call gets written, and "I will just add the
  // SDK back for this one screen" is how it would come back.
  const source = [
    'src/pages', 'src/components', 'src/hooks', 'src/lib', 'src/api',
  ];
  const files = source.flatMap((dir) => walk(path(dir)));
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    // No backslashes before the double quotes: inside a regex literal they are
    // already ordinary characters, and inside a character class doubly so.
    assert.ok(!/from ['"][^'"]*base44[^'"]*['"]/i.test(text), `${file} still imports from Base44`);
  }
});

test('the @ alias is spelled out rather than inherited from a plugin', () => {
  // It came from @base44/vite-plugin. Every import in this app uses it, so
  // removing the plugin without it fails the build on the first module — and
  // the reason to pin it is that the failure is loud now and would be a
  // mystery later.
  const config = read('vite.config.js');
  assert.match(config, /alias/);
  assert.match(config, /'@':/);
});

test('the Worker forwards nothing to Base44 from the browser-facing prefix', () => {
  const worker = read('worker/index.js');
  assert.ok(!/BASE44_PREFIX|proxyToBase44/.test(worker));
});

test('the rollback switch is left alone, because the data migration has not run', () => {
  // worker/lib/data.js and its base44 branch are the one-command rollback:
  // `wrangler secret put DATA_BACKEND` with `base44` and the app is back on the
  // old database in under a minute, from a phone, by somebody who is panicking.
  // It outlives the tidiness of deleting it, and it cannot work without the
  // module it selects.
  assert.ok(existsSync(path('worker/lib/base44.js')), 'data.js selects this module');
  const data = read('worker/lib/data.js');
  assert.match(data, /import \* as base44 from '\.\/base44\.js'/);
  assert.match(data, /if \(!raw\) return 'base44'/, 'unset must still mean the database holding the data');
});

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(js|jsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}
