/**
 * The 404 that cost the app its entire service worker.
 *
 * Cloudflare's assets binding strips `.html`, so /offline.html answers 307 to
 * /offline. /offline was in none of the known-route sets in worker/index.js, so
 * the fallback at the bottom of that file did what it does to any unrecognised
 * path: took the binding's correct 200 — the real offline page, right content,
 * right title — and rewrote the status to 404.
 *
 * That alone would be cosmetic. What made it expensive is that
 * public/service-worker.js precaches that URL, and cache.addAll is atomic: one
 * rejected fetch fails the install event, so the worker never activates.
 * Measured in production before the fix: getRegistrations() returned zero and
 * billtap-precache-v4 existed but held nothing. No offline page, no runtime
 * caching, and no install prompt — Chrome will not offer "Add to Home Screen"
 * without an active worker.
 *
 * The service worker's own header called it: "addAll is atomic: a single 404
 * rejects the install and the worker never activates, taking the offline page
 * down with it."
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const worker = read('worker/index.js');
const sw = read('public/service-worker.js');

/** The precache list as written, minus comments. */
function precacheUrls() {
  const body = sw.slice(sw.indexOf('const PRECACHE_URLS'));
  const list = body.slice(0, body.indexOf(']'));
  return [...list.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

test('every precached URL is a route the Worker will answer 200 for', () => {
  /**
   * The invariant that was broken. Anything in this list that the Worker treats
   * as unknown gets a 404, and one 404 takes the whole service worker with it —
   * so this is not a style rule, it is the install succeeding or not.
   */
  const known = worker.slice(worker.indexOf('const STATIC_HTML'));
  const staticHtml = [...known.slice(0, known.indexOf(']')).matchAll(/'([^']+)'/g)].map((m) => m[1]);

  const unroutable = precacheUrls().filter((u) => {
    if (u.startsWith('/icons/') || u.startsWith('/img/')) return false;   // real files, excluded from run_worker_first
    if (u === '/manifest.json') return false;                             // ditto
    return !staticHtml.includes(u);
  });

  assert.deepEqual(unroutable, [],
    'these are precached but the Worker does not recognise them, so addAll will 404 and the service worker will never install');
});

test('the offline fallback looks up exactly what was precached', () => {
  // caches.match on a URL that was never put in is a silent miss, and the guest
  // gets a bare 503 instead of the page written for this.
  const urls = precacheUrls();
  const matched = /caches\.match\('([^']+)'\)/.exec(sw);
  assert.ok(matched, 'the offline fallback no longer looks anything up');
  assert.ok(urls.includes(matched[1]),
    `offline() matches ${matched[1]}, which is not in the precache list (${urls.join(', ')})`);
});

test('the extensionless spelling is the one precached, not the .html redirect', () => {
  // A redirected response is the wrong thing to hold in a precache, and the
  // binding will always redirect the .html form.
  assert.ok(precacheUrls().includes('/offline'));
  assert.ok(!precacheUrls().includes('/offline.html'));
});

test('both spellings stay routable, since links to either exist', () => {
  const known = worker.slice(worker.indexOf('const STATIC_HTML'));
  const staticHtml = known.slice(0, known.indexOf(']'));
  assert.match(staticHtml, /'\/offline\.html'/);
  assert.match(staticHtml, /'\/offline'/);
});

test('the cache version moved, so the empty v4 caches are evicted', () => {
  // Every v4 precache in the wild was left behind by an install that could not
  // finish. Reusing the name would keep serving from an empty cache.
  assert.match(sw, /const VERSION = 'v[5-9]'/, 'the precache list changed without a version bump');
});
