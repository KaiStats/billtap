/**
 * ── What this file is allowed to do ──────────────────────────────────────────
 *
 * A service worker is the only cache in the stack that outlives a deploy, an
 * eviction and a `Cache-Control` header. Everything else — Cloudflare's edge,
 * the browser's HTTP cache — takes its instructions from `public/_headers` and
 * obeys them. This does not. A response it stores is served until this file
 * decides otherwise, so every rule here has to agree with the one in _headers
 * or it silently replaces it.
 *
 * It did not agree. `caches.match(request)` first, network only on a miss,
 * applied to everything matching /\.(js|css|png|svg|ico|woff2?|ttf)$/ — which is
 * the hashed bundles AND /analytics.js, /fonts.js and every icon. Those last
 * ones keep their filenames across builds, which is exactly why _headers gives
 * them a day rather than a year. Under cache-first with a hand-written cache
 * name they got forever: once a diner had a copy, no deploy could replace it.
 *
 * That is not hypothetical for this repo. /fonts.js shipped a version that
 * blocked first render for thirteen seconds; the fix landed the same day. A
 * returning phone would have kept the broken one until somebody remembered to
 * edit the string on line 1 of this file.
 *
 * So the split below is by whether the URL is content-addressed, not by file
 * extension:
 *
 *   /assets/*  — Vite writes index-D_aMljtz.js. New content is a new URL, so
 *                cache-first is safe forever and is what makes a repeat visit
 *                instant. Matches `immutable` in _headers.
 *
 *   everything else — stale-while-revalidate: serve the cached copy, fetch a
 *                fresh one in the background for next time. A replaced logo or
 *                a fixed /fonts.js arrives on the second load rather than never.
 *                Matches `max-age=86400, stale-while-revalidate=604800`.
 *
 * ── And a bound on what it keeps ─────────────────────────────────────────────
 *
 * The runtime cache is separate from the precache and capped. Every deploy
 * mints new hashed filenames; under one unbounded cache a phone accumulated
 * every bundle this app has ever shipped, with nothing that ever removed one.
 */

const VERSION = 'v4';
const PRECACHE = `billtap-precache-${VERSION}`;
const RUNTIME = `billtap-runtime-${VERSION}`;
const CURRENT = new Set([PRECACHE, RUNTIME]);

/**
 * What has to be there when the network is not.
 *
 * `/` is deliberately absent, and used not to be. Navigations are network-first
 * and fall back to /offline.html — the shell was never read back, so precaching
 * it was one request per install that nothing consumed, plus one more URL that
 * could fail. `addAll` is atomic: a single 404 rejects the install and the
 * worker never activates, taking the offline page down with it.
 */
const PRECACHE_URLS = [
  '/offline.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon.svg',
];

/**
 * A current build emits 57 files into dist/assets, and a single page fetches a
 * fraction of them — the chunk split in vite.config.js is what makes that true.
 * 150 is comfortably more than one build's worth plus the icons and images, so
 * a deploy evicts the previous build's chunks and nothing the live page is
 * using.
 *
 * Cache API keys come back in insertion order, so trimming from the front drops
 * the oldest, and whatever the current page just fetched is at the back. A miss
 * is a network fetch, not a failure.
 */
const RUNTIME_MAX_ENTRIES = 150;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(PRECACHE).then((cache) => cache.addAll(PRECACHE_URLS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !CURRENT.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/** Content-addressed output: the filename changes when the bytes do. */
function isImmutable(url) {
  return url.pathname.startsWith('/assets/');
}

/** Things worth holding on to at all. Anything else is network-only. */
function isStatic(url) {
  return /\.(js|css|png|jpe?g|webp|svg|ico|woff2?|ttf)$/.test(url.pathname);
}

/** Only complete, same-origin, successful responses go in a cache. */
function isCacheable(response) {
  return Boolean(response) && response.status === 200 && response.type !== 'opaque';
}

async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length <= RUNTIME_MAX_ENTRIES) return;
  await Promise.all(keys.slice(0, keys.length - RUNTIME_MAX_ENTRIES).map((k) => cache.delete(k)));
}

async function store(request, response) {
  if (!isCacheable(response)) return;
  const cache = await caches.open(RUNTIME);
  await cache.put(request, response);
  await trim(cache);
}

async function offline() {
  const cached = await caches.match('/offline.html');
  return cached || new Response('Offline', { status: 503 });
}

/**
 * The runtime copy, or the precached one as a seed.
 *
 * Order matters and a bare `caches.match()` gets it wrong. CacheStorage.match
 * walks the caches in creation order, so the precache — opened first, during
 * install — answers for anything in PRECACHE_URLS forever, and the fresher copy
 * that revalidation just wrote into the runtime cache is never reached. That
 * would have quietly exempted the icons and manifest.json from the very
 * refresh-on-next-load behaviour below, which is the bug this whole file exists
 * to remove.
 */
async function cached(request) {
  const runtime = await caches.open(RUNTIME);
  return (await runtime.match(request)) || caches.match(request);
}

/** Cache-first. Correct only where the URL changes with the content. */
async function cacheFirst(request, event) {
  const hit = await cached(request);
  if (hit) return hit;
  try {
    const response = await fetch(request);
    event.waitUntil(store(request, response.clone()));
    return response;
  } catch {
    return offline();
  }
}

/**
 * Stale-while-revalidate. Fast like cache-first, but self-healing: the copy on
 * disk is always replaced by whatever the network says next, so a bad or
 * outdated unhashed asset survives exactly one more page load.
 */
async function staleWhileRevalidate(request, event) {
  const hit = await cached(request);
  const network = fetch(request)
    .then((response) => {
      event.waitUntil(store(request, response.clone()));
      return response;
    })
    .catch(() => null);

  if (hit) {
    event.waitUntil(network);
    return hit;
  }
  return (await network) || offline();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Anything with a body, or belonging to someone else, is not ours to answer.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Split state, receipts, payments. Never stored, never served from a cache,
  // not even the stale-then-revalidate kind — an old total is worse than none.
  if (url.pathname.startsWith('/api/')) return;

  // This file decides when everything else is replaced, so it must never be
  // answered out of a cache it controls. `updateViaCache: 'none'` on the
  // registration and `no-cache` in _headers say the same thing to the layers
  // below; this says it here.
  if (url.pathname === '/service-worker.js') return;

  if (request.mode === 'navigate') {
    // Network-first: the HTML carries the references to the hashed bundles, so
    // a stale shell is how a browser ends up asking for a chunk that no longer
    // exists. Cached only as the offline fallback.
    event.respondWith(fetch(request).catch(() => offline()));
    return;
  }

  if (!isStatic(url)) return;

  event.respondWith(
    isImmutable(url) ? cacheFirst(request, event) : staleWhileRevalidate(request, event)
  );
});
