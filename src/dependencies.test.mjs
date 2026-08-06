/**
 * The dependency advisories, and which ones this app is actually exposed to.
 *
 * `npm audit` counts packages in the tree. It does not know which of them reach
 * a browser, which are build tooling, or whether the vulnerable code path is one
 * this app ever executes. Six GitHub alerts on the default branch turned out to
 * be two unrelated situations with opposite answers, and the difference is not
 * visible from the severity column. js-yaml, below, is the third such situation
 * and it went the same way undici did — for the same reason, which is the useful
 * part: the question is never the severity, it is whether the code runs here.
 *
 * These tests record the decisions so the next person does not have to redo the
 * analysis — and, more to the point, so nobody reaches for `npm audit fix
 * --force` on a promotion day and takes a major version bump to fix something
 * that was never reachable.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

/**
 * ── undici: fixed, because it was free to fix ───────────────────────────────
 *
 * Five advisories (one high, four moderate) all landed on undici 7.0.0–7.28.0:
 * response desynchronisation via the retry interceptor, cross-user disclosure
 * via cache directives, CRLF injection via a blob body type, cookie attribute
 * injection.
 *
 * It arrives as wrangler → miniflare → undici, and wrangler is a
 * devDependency: miniflare is the local Workers simulator, and deployed code
 * runs on Cloudflare's own runtime, which does not use undici at all. So the
 * exposure was a developer's machine, not a diner's phone.
 *
 * Fixed anyway, with an override rather than a wrangler bump, because it cost
 * nothing: `npm audit fix` proposed *downgrading* wrangler from 4.115.0 to
 * 4.35.0 and calling it a semver-major fix, which would have been a real
 * regression traded for a tooling advisory.
 */
test('undici is pinned above the range every advisory names', () => {
  const pinned = pkg.overrides?.undici;
  assert.ok(pinned, 'package.json needs an overrides entry for undici');

  const minimum = String(pinned).replace(/^[^\d]*/, '');
  const [major, minor] = minimum.split('.').map(Number);
  assert.ok(
    major > 7 || (major === 7 && minor >= 29),
    `undici override is ${pinned}; every advisory covers >=7.0.0 <7.29.0, so the floor is 7.29.0`,
  );
});

test('the override is not quietly satisfied by wrangler being downgraded', () => {
  // The fix npm proposed. wrangler 4.115.0 is what deploys today; anything
  // materially older is a step backwards taken for a devDependency advisory.
  const declared = String(pkg.devDependencies?.wrangler || '');
  const [major, minor] = declared.replace(/^[^\d]*/, '').split('.').map(Number);
  assert.ok(
    major > 4 || (major === 4 && minor >= 115),
    `wrangler is ${declared} — npm audit suggests 4.35.0, which is older than what production deploys with`,
  );
});

/**
 * ── js-yaml: fixed, for the same reason undici was ─────────────────────────
 *
 * GHSA-5p4m-2wfm-xmqj, high, js-yaml >=4.0.0 <=4.3.0: quadratic CPU
 * consumption resolving `!!omap`, the CVE-2026-59870 fix not having been
 * backported.
 *
 * It arrives as eslint → @eslint/eslintrc → js-yaml, and eslint is a
 * devDependency. Nothing in the bundle parses YAML; `npm ls js-yaml
 * --omit=dev` is empty. The reachable surface is a linter reading a config
 * file that is checked into this repository — an attacker who can put a
 * malicious YAML file there can already run whatever they like.
 *
 * Fixed anyway, because 4.3.1 is a patch release and the fix costs nothing.
 * That is the same test undici passed: not "is it reachable" but "is not
 * fixing it cheaper than fixing it", and here it plainly is not.
 *
 * An override rather than an eslint bump, because eslint 9.39.5 does not
 * depend on a fixed eslintrc yet — waiting for it would leave the alert open
 * for a transitive dependency two levels down that nobody here controls.
 */
test('js-yaml is pinned above the omap advisory', () => {
  const pinned = pkg.overrides?.['js-yaml'];
  assert.ok(pinned, 'package.json needs an overrides entry for js-yaml');

  const [major, minor, patch] = String(pinned).replace(/^[^\d]*/, '').split('.').map(Number);
  assert.ok(
    major > 4 || (major === 4 && (minor > 3 || (minor === 3 && patch >= 1))),
    `js-yaml override is ${pinned}; GHSA-5p4m-2wfm-xmqj covers <=4.3.0, so the floor is 4.3.1`,
  );
  // Deliberately a 4.x floor. js-yaml 5 is out and eslintrc asks for ^4, so a
  // 5.x override would be a major bump smuggled in as a security fix — the
  // exact move the rest of this file exists to prevent.
  assert.ok(major === 4, `js-yaml override is ${pinned}; @eslint/eslintrc wants ^4, so stay on 4.x`);
});

/**
 * ── react-router: NOT upgraded, deliberately ───────────────────────────────
 *
 * GHSA-qwww-vcr4-c8h2, high, react-router >=7.12.0 <8.3.0: "RSC Mode CSRF
 * Bypass Allows Action Execution Before 400 Response".
 *
 * The vulnerable surface is React Server Components mode — a server receiving a
 * router action and executing it before rejecting the request. This app is a
 * Vite SPA. It mounts BrowserRouter with declarative <Routes>, has no data
 * router, no loaders, no actions, and no server rendering of any kind: the only
 * server is worker/index.js, which serves prerendered HTML and JSON and has
 * never heard of a router action.
 *
 * The fix is react-router 8.3.0, which now exists — and it is not a version
 * bump. React Router 8 folds react-router-dom back into react-router and stops
 * publishing the former: the latest react-router-dom is 7.18.2 and there is no
 * 8.x of it, so "upgrading" means rewriting the import in all 22 files that
 * name react-router-dom, on the routing layer of a live app, to close a hole in
 * a mode this app does not enable. That is more risk than the advisory carries.
 *
 * Written down because the alert will keep appearing and the obvious next move
 * — `npm i react-router-dom@8` — fails with a confusing error rather than
 * telling you the package was retired.
 *
 * This test fails the day that stops being true — which is the point. If
 * anybody adopts createBrowserRouter, a loader, an action, or RSC, the
 * reasoning above expires and the upgrade becomes real work that has to happen.
 */
test('react-router is not downgraded to "fix" the advisory', () => {
  /**
   * The trap. `npm audit` proposes react-router-dom 7.11.0, because 7.11.0 is
   * the last release before the RSC advisory's range opens. Taking that
   * suggestion trades one unreachable advisory for fourteen, several of which
   * this app very much can reach:
   *
   *   GHSA-wrjc-x8rr-h8h6  open redirect via backslash in <Link> and
   *                        useNavigate           <7.18.0   - both are used here
   *   GHSA-2w69-qvjg-hvjx  XSS via open redirects        <=7.11.0
   *   GHSA-jjmj-jmhj-qwj2  open redirect leading to XSS  <=7.12.0
   *   GHSA-chx6-hx7r-mcp5  unauthenticated DoS via route matching  <7.18.0
   *
   * plus ten more covering SSR hydration, single-fetch and __manifest, which
   * this app does not run. npm's own verdict flips once you are down there:
   * fixAvailable becomes react-router-dom 7.18.2, isSemVerMajor false.
   *
   * 7.18.0 is the floor where the reachable ones are all closed.
   */
  const declared = String(pkg.dependencies?.['react-router-dom'] || '');
  const [major, minor] = declared.replace(/^[^\d]*/, '').split('.').map(Number);
  assert.ok(
    major > 7 || (major === 7 && minor >= 18),
    `react-router-dom is ${declared}. Anything below 7.18.0 carries reachable ` +
    'open-redirect, XSS and DoS advisories - strictly worse than the one ' +
    'unreachable RSC advisory that downgrading is meant to silence.',
  );
});

test('nothing has adopted the router mode the advisory is about', () => {
  const walk = (dir) => {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = join(dir, e.name);
      if (e.isDirectory()) return walk(full);
      return /\.(jsx?|tsx?)$/.test(e.name) ? [full] : [];
    });
  };

  const offenders = [];
  for (const file of walk(join(ROOT, 'src'))) {
    if (file.endsWith('.test.mjs')) continue;
    const text = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const marker of ['createBrowserRouter', 'createHashRouter', 'RouterProvider', 'unstable_']) {
      if (text.includes(marker)) offenders.push(`${file.slice(ROOT.length + 1)}: ${marker}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'the data router is in use, so GHSA-qwww-vcr4-c8h2 may now apply and the ' +
    'react-router-dom 8 upgrade is no longer optional:\n  ' + offenders.join('\n  '),
  );
});
