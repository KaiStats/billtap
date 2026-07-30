/**
 * Routing contract for the Worker.
 *
 *   npm test
 *
 * The point of this file is drift: SPA_ROUTES in index.js has to stay in sync
 * with the <Route> table in src/App.jsx. Add a page there and forget here and
 * the new page starts serving 404s to Google while still looking fine in a
 * browser — which is exactly the kind of bug nobody notices for a month.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import worker from './index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Minimal JSONC reader — strips comments without mangling the // inside string
 * values. Not a general parser; sufficient for wrangler.jsonc.
 */
function readJsonc(path) {
  const src = readFileSync(path, 'utf8');
  let out = '';
  let inString = false;
  let inLine = false;
  let inBlock = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const next = src[i + 1];

    if (inLine) {
      if (c === '\n') { inLine = false; out += c; }
      continue;
    }
    if (inBlock) {
      if (c === '*' && next === '/') { inBlock = false; i++; }
      continue;
    }
    if (inString) {
      if (c === '\\') { out += c + (next ?? ''); i++; continue; }
      if (c === '"') inString = false;
      out += c;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === '/' && next === '/') { inLine = true; i++; continue; }
    if (c === '/' && next === '*') { inBlock = true; i++; continue; }
    out += c;
  }
  return JSON.parse(out);
}

const html = (body = '<!doctype html><html>shell</html>') =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });

const file = (type, body) =>
  new Response(body, { status: 200, headers: { 'content-type': type } });

/** Stands in for the Cloudflare assets binding, including its SPA fallback. */
const env = {
  ASSETS: {
    fetch: (request) => {
      const path = new URL(request.url).pathname;
      switch (path) {
        case '/robots.txt': return file('text/plain', 'User-agent: *');
        case '/sitemap.xml': return file('application/xml', '<urlset/>');
        case '/assets/app-abc123.js': return file('application/javascript', '');
        case '/icons/icon-512.png': return file('image/png', '');
        case '/offline.html': return html('<html>offline</html>');
        default: return html(); // not_found_handling: single-page-application
      }
    },
  },
};

const get = (path) => worker.fetch(new Request(`https://billtap.app${path}`), env);

test('serves the SPA shell for real routes', async () => {
  for (const path of ['/', '/restaurants', '/privacy', '/terms', '/about', '/dashboard']) {
    assert.equal((await get(path)).status, 200, path);
  }
});

test('trailing slashes resolve to the same route', async () => {
  assert.equal((await get('/restaurants/')).status, 200);
});

test('per-table QR deep links boot the SPA', async () => {
  assert.equal((await get('/r/rosewood-table-4')).status, 200);
});

test('static files pass through untouched', async () => {
  for (const path of ['/robots.txt', '/sitemap.xml', '/assets/app-abc123.js', '/icons/icon-512.png', '/offline.html']) {
    assert.equal((await get(path)).status, 200, path);
  }
});

test('legacy capitalised paths 301 at the edge', async () => {
  const res = await get('/Restaurants');
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), 'https://billtap.app/restaurants');
});

test('legacy redirects preserve the query string', async () => {
  const res = await get('/Restaurants?utm_source=flyer');
  assert.equal(res.headers.get('location'), 'https://billtap.app/restaurants?utm_source=flyer');
});

test('unknown paths return a real 404, not a soft one', async () => {
  for (const path of ['/totally-made-up', '/restaurants/extra', '/nope.js']) {
    assert.equal((await get(path)).status, 404, path);
  }
});

test('a 404 still carries the SPA shell so the app can render its own page', async () => {
  const res = await get('/totally-made-up');
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(await res.text(), /<html/);
});

test('unmatched API paths 404 as JSON, never as HTML', async () => {
  const res = await get('/api/does-not-exist');
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('content-type'), 'application/json');
});

/**
 * The deploy config is part of the routing contract.
 *
 * Every test above calls worker.fetch() directly, which proves the logic is
 * correct but says nothing about whether Cloudflare ever invokes it. With
 * not_found_handling: "single-page-application" the assets binding matches every
 * path, so unless run_worker_first is true the Worker only sees the routes named
 * in that list — and the 404s and 301s below it are dead code in production
 * while this file still reports all green. That is exactly what shipped once.
 */
test('wrangler.jsonc actually routes page requests through the Worker', () => {
  const { assets } = readJsonc(join(ROOT, 'wrangler.jsonc'));

  assert.equal(
    assets.run_worker_first,
    true,
    'run_worker_first must be true — a path list leaves SPA_ROUTES and ' +
      'LEGACY_REDIRECTS unreachable in production, since the SPA fallback ' +
      'matches every path before the Worker is consulted.',
  );

  assert.equal(
    assets.not_found_handling,
    'single-page-application',
    'the QR deep links (/r/<slug>, /restaurants) depend on the SPA fallback',
  );
});
