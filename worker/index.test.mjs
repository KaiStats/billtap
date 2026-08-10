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

        // Model Cloudflare's html_handling, which is what made the root
        // snapshot unreachable in production: a request carrying ".html" is
        // redirected to the extensionless form, and the extensionless form is
        // what actually serves the file. Asking for "/index-prerendered.html"
        // gets a 301, not the document.
        if (SNAPSHOTS.has(path)) {
          return new Response(null, {
            status: 301,
            headers: { location: path.replace(/\.html$/, '') },
          });
        }
        if (SNAPSHOTS.has(`${path}.html`)) {
          return prerendered ? html(`<html>prerendered ${path}.html</html>`) : html();
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

test('the ROOT route serves its snapshot', async () => {
  // Called out on its own because the root is the one route html_handling does
  // not rescue by itself. "/restaurants" resolves to restaurants.html on its
  // own, so the other routes looked correct even while the Worker's snapshot
  // lookup was requesting the ".html" path and getting a 301 back; "/" maps to
  // index.html — the SPA shell — so only the root exposed the bug, and it
  // shipped unprerendered in production.
  const res = await get('/');
  assert.equal(res.status, 200);
  assert.match(
    await res.text(),
    /prerendered \/index-prerendered\.html/,
    '/ must serve dist/index-prerendered.html, not the SPA shell',
  );
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

// ── Environment isolation, as configured rather than as described ───────────
//
// wrangler.jsonc said of both non-production environments: "No routes, so it
// publishes to a workers.dev subdomain and cannot answer for billtap.app. No
// crons." Neither was true. `routes` and `triggers` are inheritable, so
// `wrangler deploy --env staging` would have reassigned the apex custom domain
// away from the production Worker — the same outcome the file spends a
// paragraph warning about elsewhere, arrived at a quieter way.
//
// Meanwhile `vars` and `unsafe` are NOT inherited, so the two things that
// protect a non-production deployment were the ones that went missing:
// PRODUCTION_SUPABASE_URL, which assertEnvironmentIsolated compares against to
// refuse a staging deploy pointed at production's database, and the rate-limit
// binding.
//
// Wrangler prints all of this on every dry run. Nothing read it, so these
// assert it instead.

test('no non-production environment can take billtap.app', () => {
  const config = readJsonc(join(ROOT, 'wrangler.jsonc'));
  const envs = config.env || {};
  assert.ok(Object.keys(envs).length, 'expected staging and development to exist');

  for (const [name, env] of Object.entries(envs)) {
    assert.ok(
      Array.isArray(env.routes),
      `env.${name} must declare "routes" — omitting it INHERITS the top-level ` +
      'routes, which include the billtap.app custom domain, and deploying it ' +
      'reassigns the domain away from production',
    );
    assert.equal(
      env.routes.length,
      0,
      `env.${name} must have no routes; the printed QR codes point at production`,
    );
  }
});

test('every environment can perform its own isolation check', () => {
  // assertEnvironmentIsolated compares SUPABASE_URL against
  // PRODUCTION_SUPABASE_URL. It cannot compare against a variable that is not
  // there, and vars do not inherit — so a missing entry here does not weaken
  // the guard, it removes it.
  const config = readJsonc(join(ROOT, 'wrangler.jsonc'));
  const production = config.vars?.PRODUCTION_SUPABASE_URL;
  assert.ok(production, 'the top level must record which project is production');

  for (const [name, env] of Object.entries(config.env || {})) {
    assert.equal(
      env.vars?.PRODUCTION_SUPABASE_URL,
      production,
      `env.${name}.vars must repeat PRODUCTION_SUPABASE_URL — vars are not inherited, ` +
      'and without it the "you are pointed at production" check silently passes',
    );
    assert.ok(env.vars?.ENVIRONMENT, `env.${name}.vars must name its own ENVIRONMENT`);
  }
});

test('no non-production environment inherits the nightly cron', () => {
  // Harmless in itself — worker/lib/environment.js refuses scheduled work
  // outside production — but a job that is scheduled and then declines is not
  // the same as one that was never scheduled, and only one of them is what the
  // file claims.
  const config = readJsonc(join(ROOT, 'wrangler.jsonc'));
  for (const [name, env] of Object.entries(config.env || {})) {
    assert.ok(
      Array.isArray(env.triggers?.crons),
      `env.${name} must declare "triggers.crons" — it is inheritable`,
    );
    assert.equal(env.triggers.crons.length, 0, `env.${name} must not run production's crons`);
  }
});

test('the rate limiter is declared per environment, on its own namespace', () => {
  const config = readJsonc(join(ROOT, 'wrangler.jsonc'));
  const namespaces = new Set();

  const limiterOf = (scope, label) => {
    const binding = (scope.unsafe?.bindings || []).find((b) => b.name === 'API_RATE_LIMITER');
    assert.ok(binding, `${label} has no API_RATE_LIMITER — "unsafe" is not inherited`);
    return binding;
  };

  const top = limiterOf(config, 'the top level');
  namespaces.add(top.namespace_id);

  for (const [name, env] of Object.entries(config.env || {})) {
    const binding = limiterOf(env, `env.${name}`);
    assert.ok(
      !namespaces.has(binding.namespace_id),
      `env.${name} shares rate-limit namespace ${binding.namespace_id} with another ` +
      'environment, so a load test on one throttles a real restaurant on the other',
    );
    namespaces.add(binding.namespace_id);
  }
});

// ── Scheduled work ──────────────────────────────────────────────────────────
//
// The backup and the retention pass used to run from one 09:00 firing, back to
// back through waitUntil. That is one Worker invocation and therefore one
// subrequest budget shared between two jobs that both spend in bulk — the
// backup pages every entity, retention writes and deletes per session. Whichever
// ran second would be the one that ran out, overnight, unobserved.
//
// They have their own schedules now, and the handler dispatches on event.cron.
// A typo in either place means the retention job silently never runs while the
// backup runs twice, so these compare the two.

test('the retention schedule the handler looks for is one wrangler actually fires', async () => {
  const { RETENTION_CRON } = await import('../worker/index.js');
  const { triggers } = readJsonc(join(ROOT, 'wrangler.jsonc'));
  assert.ok(Array.isArray(triggers?.crons), 'wrangler.jsonc must declare triggers.crons');
  assert.ok(
    triggers.crons.includes(RETENTION_CRON),
    `worker/index.js dispatches retention on "${RETENTION_CRON}", which is not in ` +
    `triggers.crons (${JSON.stringify(triggers.crons)}) — the job would never run`,
  );
});

test('the backup and the retention pass do not share an invocation', () => {
  const { triggers } = readJsonc(join(ROOT, 'wrangler.jsonc'));
  assert.ok(
    triggers.crons.length >= 2,
    'both jobs on one schedule means one subrequest budget between them',
  );
  assert.equal(
    new Set(triggers.crons).size,
    triggers.crons.length,
    'duplicate schedules would fire the same invocation twice, not give it more budget',
  );
});

test('each scheduled firing runs exactly one job', async () => {
  const { RETENTION_CRON, default: worker } = await import('../worker/index.js');
  const ran = [];
  const ctx = { waitUntil: (p) => { ran.push(p); return p; } };
  // No bindings: both jobs decline early and neither throws out of the handler.
  const env = { ENVIRONMENT: 'development' };

  await worker.scheduled({ cron: RETENTION_CRON }, env, ctx);
  assert.equal(ran.length, 1, 'the retention firing starts one job');

  ran.length = 0;
  await worker.scheduled({ cron: '0 9 * * *' }, env, ctx);
  assert.equal(ran.length, 1, 'the backup firing starts one job');

  // Whatever those promises do, they must not reject out of the handler — a
  // rejection marks the invocation failed and loses the log line that says why.
  await Promise.allSettled(ran);
});

/**
 * A page that is prerendered but absent from the sitemap is a page built for
 * crawlers and then not shown to them.
 *
 * Found on the way into a promotion: eight routes were prerendered and seven
 * were listed. /security was the missing one — the page whose whole purpose is
 * being findable by somebody with a vulnerability to report.
 *
 * Checked rather than remembered, because the failure is silent in both
 * directions. Nothing 404s, nothing errors; the page simply never gets crawled,
 * and the only symptom is traffic that does not arrive.
 */
test('every prerendered route is in the sitemap', () => {
  const sitemap = readFileSync(join(ROOT, 'public', 'sitemap.xml'), 'utf8');
  const listed = new Set(
    [...sitemap.matchAll(/<loc>https:\/\/billtap\.app(\/[^<]*)<\/loc>/g)]
      // The home page is listed as "/" with a trailing slash; PRERENDERED keys
      // it as "/". Normalise so they compare.
      .map((m) => (m[1] === '/' ? '/' : m[1].replace(/\/$/, ''))),
  );

  const missing = Object.keys(PRERENDERED).filter((route) => !listed.has(route));
  assert.deepEqual(
    missing,
    [],
    `prerendered but not in public/sitemap.xml, so never crawled: ${missing.join(', ')}`,
  );
});

test('the sitemap lists nothing robots.txt forbids', () => {
  // The opposite mistake, and a worse one: submitting a URL in the sitemap that
  // the same site tells crawlers not to fetch is a Search Console error on
  // every one of them.
  const sitemap = readFileSync(join(ROOT, 'public', 'sitemap.xml'), 'utf8');
  const robots = readFileSync(join(ROOT, 'public', 'robots.txt'), 'utf8');
  const disallowed = [...robots.matchAll(/^Disallow:\s*(\S+)/gm)].map((m) => m[1]);
  const listed = [...sitemap.matchAll(/<loc>https:\/\/billtap\.app([^<]*)<\/loc>/g)].map((m) => m[1] || '/');

  for (const url of listed) {
    for (const rule of disallowed) {
      assert.ok(
        !(url === rule || url.startsWith(rule.endsWith('/') ? rule : `${rule}/`)),
        `sitemap lists ${url}, which robots.txt disallows via "${rule}"`,
      );
    }
  }
});

/**
 * The reconcile firing, checked the same way the other two are.
 *
 * `plan` could only move forward before this job existed — verify-checkout
 * wrote 'active' and nothing wrote anything else. A typo in either the cron
 * string or the dispatch would put that back, silently, and the symptom would
 * be cancelled restaurants keeping full service for as long as anyone looked.
 */
test('the reconcile schedule the handler looks for is one wrangler actually fires', async () => {
  const { RECONCILE_CRON } = await import('../worker/index.js');
  const { triggers } = readJsonc(join(ROOT, 'wrangler.jsonc'));
  assert.ok(
    triggers.crons.includes(RECONCILE_CRON),
    `worker/index.js dispatches billing reconciliation on "${RECONCILE_CRON}", which is ` +
    `not in triggers.crons (${JSON.stringify(triggers.crons)}) — the job would never run`,
  );
});

test('the reconcile pass gets its own invocation, like the other two', async () => {
  // Its own subrequest budget: this one makes an API call per subscribed
  // restaurant, and sharing an invocation with the backup is how the second
  // job overnight becomes the one that runs out.
  const { RECONCILE_CRON, RETENTION_CRON, default: worker } = await import('../worker/index.js');
  const { triggers } = readJsonc(join(ROOT, 'wrangler.jsonc'));
  assert.equal(new Set(triggers.crons).size, triggers.crons.length, 'no duplicate schedules');
  assert.notEqual(RECONCILE_CRON, RETENTION_CRON);

  const ran = [];
  const ctx = { waitUntil: (p) => { ran.push(p); return p; } };
  await worker.scheduled({ cron: RECONCILE_CRON }, { ENVIRONMENT: 'development' }, ctx);
  assert.equal(ran.length, 1, 'the reconcile firing starts exactly one job');
  await Promise.allSettled(ran);
});
