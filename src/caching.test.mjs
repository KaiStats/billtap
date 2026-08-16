/**
 * The caching layer, exercised rather than described.
 *
 * Three caches decide what a returning diner actually receives — Cloudflare's
 * edge (public/_headers), the browser's HTTP cache (the same file) and the
 * service worker (public/service-worker.js). Only the first two take
 * instructions. The service worker is a program, and it was quietly overruling
 * both: cache-first on every .js/.css/.png meant an unhashed file — /fonts.js,
 * /analytics.js, a replaced logo — was frozen on a device the moment it was
 * first fetched, no matter what _headers said, until somebody hand-edited a
 * cache name.
 *
 * So this file loads the real service-worker.js and runs its handlers against a
 * fake CacheStorage instead of asserting on its source text. A policy you can
 * only read is a policy that drifts; this one is executed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://billtap.app';

const headersFile = readFileSync(join(ROOT, 'public/_headers'), 'utf8');
const swSource = readFileSync(join(ROOT, 'public/service-worker.js'), 'utf8');
const registerSource = readFileSync(join(ROOT, 'src/lib/registerServiceWorker.js'), 'utf8');
const wrangler = readFileSync(join(ROOT, 'wrangler.jsonc'), 'utf8');

// ── A service worker environment, small enough to reason about ──────────────

const abs = (r) => new URL(typeof r === 'string' ? r : r.url, ORIGIN).toString();

class FakeCache {
  constructor() {
    // Insertion-ordered, which is what the real Cache API guarantees for keys()
    // and what the trimming in the worker depends on.
    this.entries = new Map();
  }
  async put(request, response) { this.entries.set(abs(request), response); }
  async match(request) { return this.entries.get(abs(request)); }
  async keys() { return [...this.entries.keys()].map((url) => ({ url })); }
  async delete(request) { return this.entries.delete(abs(request)); }
  async addAll(urls) {
    for (const url of urls) this.entries.set(abs(url), new Response('precached'));
  }
}

function makeEnvironment({ network }) {
  const caches = {
    store: new Map(),
    async open(name) {
      if (!this.store.has(name)) this.store.set(name, new FakeCache());
      return this.store.get(name);
    },
    async keys() { return [...this.store.keys()]; },
    async delete(name) { return this.store.delete(name); },
    async match(request) {
      for (const cache of this.store.values()) {
        const hit = await cache.match(request);
        if (hit) return hit;
      }
      return undefined;
    },
  };

  const listeners = new Map();
  const fetches = [];
  const self = {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    location: { origin: ORIGIN },
    skipWaiting() {},
    clients: { claim: async () => {} },
  };

  const fetchStub = async (request) => {
    fetches.push(abs(request));
    return network(abs(request));
  };

  // eslint-disable-next-line no-new-func
  new Function('self', 'caches', 'fetch', 'Response', 'URL', swSource)(
    self, caches, fetchStub, Response, URL,
  );

  async function dispatch(type, event) {
    const pending = [];
    const context = {
      ...event,
      waitUntil: (p) => pending.push(Promise.resolve(p).catch(() => {})),
      respondWith: (p) => { context.response = p; },
    };
    for (const fn of listeners.get(type) || []) fn(context);
    const answered = context.response ? await context.response : undefined;
    await Promise.all(pending);
    return answered;
  }

  const get = (path, mode = 'no-cors') =>
    dispatch('fetch', { request: { url: ORIGIN + path, method: 'GET', mode } });

  return { caches, fetches, dispatch, get };
}

/** Installs and activates, so the precache and offline fallback are in place. */
async function boot(network = async () => new Response('body')) {
  const env = makeEnvironment({ network });
  await env.dispatch('install', {});
  await env.dispatch('activate', {});
  env.fetches.length = 0;
  return env;
}

// ── The bug this layer was here to find ─────────────────────────────────────

test('an unhashed asset is refreshed in the background, not frozen forever', async () => {
  // /fonts.js and /analytics.js keep their names across builds. Under the old
  // cache-first rule the first copy a phone fetched was the last one it would
  // ever see — and fonts.js has already shipped a version that blocked first
  // render for thirteen seconds. The fix landing in the repo has to be a fix
  // that lands on the device.
  let generation = 'old';
  const env = await boot(async () => new Response(generation));

  assert.equal(await (await env.get('/fonts.js')).text(), 'old');

  generation = 'fixed';
  // Second load still serves the cached copy — that is the "stale" half, and
  // it is what makes it fast — but it must have gone to the network as well.
  assert.equal(await (await env.get('/fonts.js')).text(), 'old');
  assert.ok(
    env.fetches.filter((u) => u.endsWith('/fonts.js')).length >= 2,
    'no revalidation: the cached copy is being served with nothing fetching a newer one',
  );

  // Third load gets the fix. Under cache-first this stayed "old" forever.
  assert.equal(await (await env.get('/fonts.js')).text(), 'fixed');
});

test('the same is true of icons and images, which _headers gives a day', async () => {
  let generation = 'v1';
  const env = await boot(async () => new Response(generation));
  await env.get('/img/hero.webp');
  generation = 'v2';
  await env.get('/img/hero.webp');
  assert.equal(await (await env.get('/img/hero.webp')).text(), 'v2');
});

test('a precached icon is refreshed too, not pinned by the precache', async () => {
  // CacheStorage.match walks caches in creation order, so the precache — opened
  // during install, before the runtime cache exists — answers first for
  // anything in PRECACHE_URLS. Read through a bare caches.match() that silently
  // exempts every icon and manifest.json from revalidation: the fresh copy gets
  // written to the runtime cache and never read back.
  let generation = 'v1';
  const env = await boot(async () => new Response(generation));
  await env.get('/icons/icon-192.png');
  generation = 'v2';
  await env.get('/icons/icon-192.png');
  assert.equal(
    await (await env.get('/icons/icon-192.png')).text(),
    'v2',
    'the precached copy is shadowing the revalidated one',
  );
});

test('content-hashed bundles are served from cache without a second request', async () => {
  // The other half: /assets/index-D_aMljtz.js cannot go stale, because a new
  // build is a new URL. This is the case where cache-first is free, and it is
  // what makes a repeat visit instant.
  const env = await boot();
  await env.get('/assets/index-D_aMljtz.js');
  const after = env.fetches.length;
  await env.get('/assets/index-D_aMljtz.js');
  assert.equal(env.fetches.length, after, 'an immutable asset was refetched');
});

// ── What must never be cached ───────────────────────────────────────────────

test('API responses are not answered from any cache', async () => {
  // Split totals, receipts, payment state. A stale total is worse than a slow
  // one, and stale-while-revalidate is still stale on the load that matters.
  const env = await boot();
  assert.equal(await env.get('/api/fn/getSplitStatus'), undefined);
  assert.equal(await env.get('/api/scan-receipt'), undefined);

  // The two above have no file extension, so the static-asset check would skip
  // them anyway — which is exactly why the explicit /api/ guard has to be
  // tested with something that would otherwise qualify. The day an API route
  // serves a receipt image or a generated QR under /api/, "it happened not to
  // match the extension list" stops being protection.
  assert.equal(await env.get('/api/receipts/abc.png'), undefined);
  assert.equal(await env.get('/api/qr/xyz.svg'), undefined);
});

test('the service worker script itself is never served from its own cache', async () => {
  // It is the thing that decides when everything else is replaced. A worker
  // that can serve a cached copy of itself cannot be updated.
  const env = await boot();
  assert.equal(await env.get('/service-worker.js'), undefined);
});

test('cross-origin and non-GET requests are left alone', async () => {
  const env = await boot();
  assert.equal(
    await env.dispatch('fetch', {
      request: { url: 'https://plausible.io/api/event', method: 'GET', mode: 'no-cors' },
    }),
    undefined,
  );
  assert.equal(
    await env.dispatch('fetch', {
      request: { url: ORIGIN + '/assets/x.js', method: 'POST', mode: 'no-cors' },
    }),
    undefined,
  );
});

test('a failed response is not stored as if it were the file', async () => {
  // A 404 or a 500 cached under a bundle's URL is a page that stays broken
  // after the deploy that fixed it.
  const env = await boot(async () => new Response('nope', { status: 503 }));
  await env.get('/assets/index-abc.js');
  const runtime = [...env.caches.store.entries()].find(([name]) => name.includes('runtime'));
  assert.ok(!runtime || runtime[1].entries.size === 0, 'a non-200 response was cached');
});

// ── Bounds ──────────────────────────────────────────────────────────────────

test('the runtime cache does not grow forever', async () => {
  // Every deploy mints new hashed filenames. With one unbounded cache and a
  // hand-written cache name, a phone accumulated every bundle this app has
  // ever shipped and nothing ever removed one.
  const env = await boot();
  for (let i = 0; i < 400; i += 1) await env.get(`/assets/chunk-${i}.js`);

  const runtime = [...env.caches.store.entries()].find(([name]) => name.includes('runtime'));
  assert.ok(runtime, 'expected a runtime cache separate from the precache');
  assert.ok(
    runtime[1].entries.size <= 200,
    `runtime cache holds ${runtime[1].entries.size} entries with no upper bound`,
  );
  // And the bound has to leave room for a whole build — dist/assets is 57 files
  // today — or the cache thrashes and every deploy is a cold start.
  assert.ok(
    runtime[1].entries.size >= 100,
    `runtime cache is capped at ${runtime[1].entries.size}, below one build's worth of chunks`,
  );
  // Insertion order means the newest survive — the chunks the current page is
  // actually using were just written.
  assert.ok(runtime[1].entries.has(`${ORIGIN}/assets/chunk-399.js`));
});

test('activating drops caches from previous versions', async () => {
  const env = makeEnvironment({ network: async () => new Response('x') });
  (await env.caches.open('billtap-v3')).put('/assets/old.js', new Response('old'));
  await env.dispatch('install', {});
  await env.dispatch('activate', {});
  assert.ok(!(await env.caches.keys()).includes('billtap-v3'), 'an old cache survived activation');
});

// ── Offline ─────────────────────────────────────────────────────────────────

test('a navigation with no network gets the offline page', async () => {
  const env = makeEnvironment({ network: async () => { throw new Error('offline'); } });
  // Install succeeds — this is the point of precaching, and it is why the list
  // has to stay short enough that every entry really exists.
  await env.dispatch('install', {});
  await env.dispatch('activate', {});

  const response = await env.get('/split/abc', 'navigate');
  assert.ok(response, 'an offline navigation was not answered at all');
  // The fake precache writes 'precached' as every body, so this is the
  // assertion that it came from the precache rather than the network.
  assert.equal(await response.text(), 'precached');
  assert.equal(response.status, 200);
});

test('an offline request for an asset that was never cached does not throw', async () => {
  const env = makeEnvironment({ network: async () => { throw new Error('offline'); } });
  await env.dispatch('install', {});
  await env.dispatch('activate', {});
  const response = await env.get('/assets/never-seen.js');
  assert.ok(response, 'the handler rejected instead of answering');
});

test('navigations are network-first, so the shell is never stale', async () => {
  // index.html carries the references to the hashed bundles. Serving a cached
  // shell is how a browser ends up requesting a chunk the deploy removed.
  let html = 'build-1';
  const env = await boot(async () => new Response(html));
  await env.get('/', 'navigate');
  html = 'build-2';
  assert.equal(await (await env.get('/', 'navigate')).text(), 'build-2');
});

test('the precache holds the offline page and not the shell', async () => {
  // `/` was precached and never read back: navigations are network-first with
  // an offline.html fallback. `addAll` is atomic, so every extra URL is one
  // more 404 away from the install failing and the offline page going with it.
  const precache = swSource.slice(
    swSource.indexOf('PRECACHE_URLS'),
    swSource.indexOf(']', swSource.indexOf('PRECACHE_URLS')),
  );
  assert.ok(precache.includes('/offline.html'), 'the offline page must be precached');
  assert.ok(!/(['"])\/\1/.test(precache), 'the SPA shell is precached but never read back');
});

// ── The header policy the worker has to agree with ──────────────────────────

/** Section name → header lines, from the _headers file. */
function parseHeaders(text) {
  const rules = new Map();
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^\s*#.*$/, '');
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) { current = line.trim(); rules.set(current, []); }
    else if (current) rules.get(current).push(line.trim());
  }
  return rules;
}

const rules = parseHeaders(headersFile);

test('every root-level script index.html loads has a cache rule', () => {
  // /analytics.js and /fonts.js were split out of inline <script> blocks to get
  // 'unsafe-inline' out of the CSP, and in moving they landed at the root of
  // public/ where none of the directory rules match. So they fell back to
  // Cloudflare's `max-age=0, must-revalidate` default — a blocking conditional
  // request each, on the critical path, on every page load.
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const roots = [...html.matchAll(/(?:src|href)="(\/[\w.-]+\.(?:js|css))"/g)].map((m) => m[1]);
  assert.ok(roots.length >= 2, `expected root-level scripts in index.html, found ${roots}`);

  for (const path of roots) {
    assert.ok(rules.has(path), `${path} matches no rule in public/_headers`);
    assert.ok(
      rules.get(path).some((h) => /max-age=[1-9]/.test(h)),
      `${path} has a rule but it does not actually cache anything`,
    );
  }
});

test('immutable is claimed only where the filename carries a content hash', () => {
  for (const [path, headers] of rules) {
    if (!headers.some((h) => h.includes('immutable'))) continue;
    assert.equal(
      path,
      '/assets/*',
      `${path} is marked immutable, but its name does not change when its contents do — ` +
        'a bad build of it would be permanent on every device that fetched it',
    );
  }
});

test('nothing gives HTML a cache lifetime', () => {
  // HTML carries the references to the hashed files. Caching it is how a
  // browser ends up asking for a bundle that no longer exists.
  for (const [path, headers] of rules) {
    if (!/\.html$|^\/$|^\/\*$/.test(path)) continue;
    for (const header of headers) {
      assert.doesNotMatch(header, /max-age=[1-9]/, `${path} caches HTML: ${header}`);
    }
  }
});

test('the service worker is served no-cache', () => {
  assert.ok(rules.has('/service-worker.js'));
  assert.match(rules.get('/service-worker.js').join(' '), /no-cache/);
});

// ── The edge in front of all of it ──────────────────────────────────────────

test('the root scripts are not proxied through the Worker', () => {
  // index.html loads both on every page view. Routed through the Worker they
  // were two billable invocations per view, in front of the two files whose
  // whole job is to load quickly — and a response returned through a Worker is
  // not one the asset cache answers from the edge on its own.
  const directives = wrangler.replace(/(^|\s)\/\/.*$/gm, '$1');
  const block = directives.slice(directives.indexOf('"run_worker_first"'));
  const list = block.slice(0, block.indexOf(']') + 1);
  for (const path of ['/analytics.js', '/fonts.js']) {
    assert.ok(list.includes(`"!${path}"`), `${path} still runs the Worker on every page view`);
  }
});

test('no connection is warmed to a host nothing fetches from', () => {
  // A preconnect to a Higgsfield CloudFront distribution sat at the top of the
  // document with the note "/restaurants loads 15 frames from this origin". It
  // had stopped being true when SELF_HOSTED was flipped in both art modules:
  // every frame is now WebP from /img/ on this origin. So the browser opened
  // DNS, TCP and TLS to a third party on every page load, ahead of the requests
  // that were actually needed, and got nothing back for it.
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const markup = html.replace(/<!--[\s\S]*?-->/g, '');

  const hints = [...markup.matchAll(/rel="(preconnect|dns-prefetch|preload)"[^>]*href="([^"]+)"/g)];
  for (const [, rel, href] of hints) {
    if (!/^https?:/.test(href)) continue;
    const host = new URL(href).hostname;
    assert.ok(
      markup.includes(host) &&
        [...markup.matchAll(new RegExp(host.replace(/\./g, '\\.'), 'g'))].length > 1,
      `${rel} warms ${host}, but nothing else in the document requests it — ` +
        'that is a DNS/TCP/TLS handshake on the critical path for no fetch',
    );
  }

  assert.doesNotMatch(markup, /cloudfront\.net/, 'the dead CDN preconnect is back');
});

// ── The registration ────────────────────────────────────────────────────────

test('registration does not tear down its own worker on every page load', () => {
  // It unregistered *every* registration before registering again, including
  // the one the previous load had just installed. So the worker was rebuilt
  // from nothing on each navigation — full install, whole precache refetched —
  // and never got to be the thing it exists to be, which is already there when
  // the page starts. `register()` on the same URL is what replaces a broken
  // script; unregistering was only ever needed for workers at other scopes.
  const unregisters = [...registerSource.matchAll(/\.unregister\(\)/g)];
  assert.ok(unregisters.length > 0, 'expected the stale-scope cleanup to still exist');

  const inRegister = registerSource.slice(
    registerSource.indexOf('export async function registerServiceWorker'),
    registerSource.indexOf('export async function unregisterServiceWorkers'),
  );
  assert.match(
    inRegister,
    /\.filter\(/,
    'registerServiceWorker unregisters unconditionally — it must skip its own script URL',
  );
  assert.match(
    inRegister,
    /updateViaCache:\s*'none'/,
    "the registration must not let the HTTP cache answer the worker's own update check",
  );
});

// ── The install prompt counts visits, not taps ─────────────────────────────
//
// It incremented on every mount, so a guest scanning a table tent and pressing
// "Start the split" — two pages, ten seconds apart, on their first encounter —
// hit two and got "Install BillTap" mid-meal. Measured against production
// before the fix: first page hidden, second page shown, fresh browser both
// times. The name always said what was meant; the code counted the wrong thing.

test('a whole meal is one visit, however many screens it takes', () => {
  const src = readFileSync(new URL('./components/PWAInstallPrompt.jsx', import.meta.url), 'utf8');

  assert.match(src, /billtap-last-visit/,
    'without a timestamp there is no way to tell a return from a tap');
  assert.match(src, /RETURN_AFTER_MS/,
    'the gap that separates a visit from a page view has to be a named number');

  // The count may only move when the gap has actually elapsed.
  const guarded = /isNewVisit\s*\?\s*visitCount\s*\+\s*1\s*:\s*visitCount/.test(src);
  assert.ok(guarded, 'the counter increments unconditionally again — that is the bug');

  // And the threshold has to outlast a meal.
  const ms = src.match(/RETURN_AFTER_MS\s*=\s*(\d+)\s*\*\s*(\d+)\s*\*\s*(\d+)/);
  assert.ok(ms, 'RETURN_AFTER_MS is not a literal any more');
  const total = Number(ms[1]) * Number(ms[2]) * Number(ms[3]);
  assert.ok(total >= 20 * 60 * 1000,
    `${total}ms is shorter than a meal — a table would trip it mid-split`);
});

test('a clock that jumped backwards is not counted as a visit', () => {
  // A stored timestamp in the future means the device clock moved, not that
  // somebody came back. Treating it as a visit would fire the prompt on the
  // next page load.
  const src = readFileSync(new URL('./components/PWAInstallPrompt.jsx', import.meta.url), 'utf8');
  assert.match(src, /lastVisit\s*>\s*now/, 'a future timestamp is unhandled');
});
