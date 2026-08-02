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
import worker, { PRERENDERED } from './index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Page routes an exclusion pattern must never swallow. */
const SPA_ROUTE_SAMPLE = ['/', '/restaurants', '/about', '/blog', '/privacy', '/terms', '/r/abc'];

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

/**
 * Stands in for the Cloudflare assets binding, including its SPA fallback.
 * `prerendered` controls whether the build produced static snapshots, so both
 * `npm run build` and `npm run build:static` are covered.
 */
function makeEnv({ prerendered = true } = {}) {
  const SNAPSHOTS = new Set([
    '/index-prerendered.html',
    '/restaurants.html',
    '/about.html',
    '/blog.html',
    '/changelog.html',
    '/privacy.html',
    '/terms.html',
  ]);
  return {
    // A named environment with its own app id. The Worker refuses to serve
    // without one now — see worker/lib/environment.js — because the only
    // sensible default for an unset BASE44_APP_ID would have been production's.
    ENVIRONMENT: 'development',
    BASE44_APP_ID: 'test_app_dev',
    PRODUCTION_APP_ID: 'test_app_prod',
    ASSETS: {
      fetch: (request) => {
        const path = new URL(request.url).pathname;
        if (SNAPSHOTS.has(path)) {
          return prerendered ? html(`<html>prerendered ${path}</html>`) : html();
        }
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
}

const env = makeEnv();

const get = (path, e = env) => worker.fetch(new Request(`https://billtap.app${path}`), e);

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

test('prerendered snapshots are served for the routes that have them', async () => {
  for (const [route, expected] of [
    ['/', '/index-prerendered.html'],
    ['/restaurants', '/restaurants.html'],
    ['/about', '/about.html'],
    ['/privacy', '/privacy.html'],
  ]) {
    const res = await get(route);
    assert.equal(res.status, 200, route);
    assert.match(await res.text(), new RegExp(`prerendered ${expected}`), route);
  }
});

test('a trailing slash still finds the snapshot', async () => {
  assert.match(await (await get('/restaurants/')).text(), /prerendered \/restaurants\.html/);
});

test('without snapshots the routes fall back to the SPA shell', async () => {
  // i.e. after a plain `npm run build` rather than `npm run build:static`.
  const bare = makeEnv({ prerendered: false });
  const res = await get('/restaurants', bare);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /shell/);
});

test('snapshot .html paths 301 to the clean route', async () => {
  // Two URLs serving one page is duplicate content; the redirect settles it.
  const res = await get('/restaurants.html');
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), 'https://billtap.app/restaurants');
});

test('every prerendered route is also a known SPA route', async () => {
  // A snapshot for a path the SPA cannot render would serve static HTML that
  // React then blanks on boot.
  for (const route of ['/', '/restaurants', '/about', '/blog', '/changelog', '/privacy', '/terms']) {
    assert.equal((await get(route)).status, 200, route);
  }
});

test('the build scripts share the Worker PRERENDERED table', () => {
  // prerender.mjs writes the snapshots and verify-dist.mjs checks them; if
  // either kept its own copy of the route list, the build could write files the
  // Worker never looks for, or pass a verification that checks nothing.
  assert.ok(Object.keys(PRERENDERED).length > 0, 'PRERENDERED must be exported and non-empty');

  for (const [route, file] of Object.entries(PRERENDERED)) {
    assert.ok(route.startsWith('/'), `route ${route} must be absolute`);
    assert.match(file, /^\/[\w./-]+\.html$/, `${route} must map to an .html file`);
  }

  for (const script of ['scripts/prerender.mjs', 'scripts/verify-dist.mjs']) {
    const src = readFileSync(join(ROOT, script), 'utf8');
    assert.match(
      src,
      /import \{ PRERENDERED \} from '\.\.\/worker\/index\.js'/,
      `${script} must import PRERENDERED rather than hardcode its own route list`,
    );
  }
});

test('wrangler.jsonc gates deploys on the dist verifier', () => {
  // Without this, `npx wrangler deploy` typed straight into a terminal skips
  // every check and can ship a dist/ whose prerender step failed — which is
  // exactly what happened once.
  const { build } = readJsonc(join(ROOT, 'wrangler.jsonc'));
  assert.ok(build && build.command, 'wrangler.jsonc needs a build.command');
  assert.match(
    build.command,
    /verify-dist\.mjs/,
    `build.command must run the dist verifier (got "${build?.command}")`,
  );
});

test('HTML responses carry the anti-framing headers a meta tag cannot set', async () => {
  for (const path of ['/', '/restaurants', '/totally-made-up']) {
    const res = await get(path);
    assert.equal(res.headers.get('x-frame-options'), 'DENY', path);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff', path);
    assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin', path);
  }
});

test('non-HTML responses are passed through untouched', async () => {
  // Wrapping every asset would cost a copy for no benefit; only documents can
  // be framed.
  const res = await get('/assets/app-abc123.js');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-frame-options'), null);
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
  const rwf = assets.run_worker_first;

  // Either `true`, or a list that starts from a catch-all and only subtracts.
  // What must never come back is a positive allow-list like ["/api/*"], which
  // is what originally left SPA_ROUTES and LEGACY_REDIRECTS unreachable in
  // production while this file still passed.
  if (rwf !== true) {
    assert.ok(
      Array.isArray(rwf),
      'run_worker_first must be true or an array of patterns',
    );
    assert.ok(
      rwf.includes('/*'),
      `run_worker_first is missing a "/*" catch-all (got ${JSON.stringify(rwf)}). ` +
        'Without it the Worker never sees page requests, because the SPA fallback ' +
        'matches every path first — so the 404 statuses, the 301s and the security ' +
        'headers all silently stop happening.',
    );
    const positives = rwf.filter((p) => !p.startsWith('!'));
    assert.deepEqual(
      positives,
      ['/*'],
      `every entry after the catch-all must be a negation, or coverage has holes: ` +
        `${JSON.stringify(positives)}`,
    );
    // Excluding a page route would silently disable its redirect/404/header path.
    for (const pattern of rwf.filter((p) => p.startsWith('!'))) {
      const prefix = pattern.slice(1).replace(/\*$/, '');
      for (const route of [...SPA_ROUTE_SAMPLE]) {
        assert.ok(
          !route.startsWith(prefix),
          `${pattern} excludes the page route ${route} from the Worker`,
        );
      }
    }
  }

  assert.equal(
    assets.not_found_handling,
    'single-page-application',
    'the QR deep links (/r/<slug>, /restaurants) depend on the SPA fallback',
  );
});
