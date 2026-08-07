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
 * ── react-router: upgraded, and what it actually cost ──────────────────────
 *
 * GHSA-qwww-vcr4-c8h2, high, react-router >=7.12.0 <8.3.0: "RSC Mode CSRF
 * Bypass Allows Action Execution Before 400 Response". Closed by moving to
 * react-router 8.3.0.
 *
 * It was deliberately NOT taken for a while, and the reasoning was sound at
 * the time: the vulnerable surface is React Server Components mode, and this
 * app is a Vite SPA with declarative <Routes>, no data router, no loaders, no
 * actions and no server rendering. GitHub's own note on the alert said as
 * much — "This only affects your application if you are using the unstable
 * RSC APIs."
 *
 * ── The trap that made it worth doing properly ─────────────────────────────
 *
 * GitHub's suggested remedy was an override pinning react-router to a patched
 * version. That override installs cleanly, reports `found 0 vulnerabilities`,
 * builds with exit 0, and passes every unit test in this repository — and it
 * ships an app that crashes on load for every visitor.
 *
 * react-router 8 requires React >= 19.2.7. Forced under React 18 it imports
 * `useOptimistic`, a hook that does not exist there, and the module throws at
 * evaluation time. Nothing in this repo catches that, because no unit test
 * mounts a router: the failure is only visible in a browser.
 *
 * So the real cost of this advisory was never the import rewrite. It was
 * React 18 → 19 alongside it, plus qrcode.react 3 → 4 (the one dependency of
 * forty-two that did not declare React 19 support). That is what this commit
 * did, and it is why the two upgrades are inseparable.
 */
test('react-router is above the RSC advisory range', () => {
  const declared = String(pkg.dependencies?.['react-router'] || '');
  const [major, minor] = declared.replace(/^[^\d]*/, '').split('.').map(Number);
  assert.ok(
    major > 8 || (major === 8 && minor >= 3),
    `react-router is ${declared}; GHSA-qwww-vcr4-c8h2 covers >=7.12.0 <8.3.0`,
  );
});

test('react-router-dom is gone and stays gone', () => {
  // React Router 8 folds it back into react-router and stops publishing it —
  // the last release is 7.18.2. Reinstalling it would silently drag a second,
  // vulnerable copy of react-router into the tree beneath it, which is exactly
  // how the advisory came back the first time.
  assert.equal(
    pkg.dependencies?.['react-router-dom'],
    undefined,
    'react-router-dom is retired; import from react-router instead',
  );
});

test('React is new enough for the router to actually run', () => {
  // The trap, pinned. An override that satisfies `npm audit` while leaving
  // React at 18 produces a green build and a dead app: react-router 8 calls
  // useOptimistic, which React 18 does not have. Nothing else in this repo
  // would catch it, so this is the guard.
  const declared = String(pkg.dependencies?.react || '');
  const [major, minor] = declared.replace(/^[^\d]*/, '').split('.').map(Number);
  assert.ok(
    major > 19 || (major === 19 && minor >= 2),
    `react is ${declared}; react-router 8 requires >=19.2.7 and fails at import below it`,
  );
  assert.equal(
    String(pkg.dependencies?.['react-dom'] || '').replace(/^[^\d]*/, '').split('.')[0],
    String(major),
    'react and react-dom must move together',
  );
});

test('qrcode.react is new enough for React 19', () => {
  // The only package of forty-two peering on React that did not allow 19.
  // 4.2.0 is the first release that does; the QRCodeSVG export is unchanged.
  const declared = String(pkg.dependencies?.['qrcode.react'] || '');
  const [major, minor] = declared.replace(/^[^\d]*/, '').split('.').map(Number);
  assert.ok(
    major > 4 || (major === 4 && minor >= 2),
    `qrcode.react is ${declared}; React 19 support starts at 4.2.0`,
  );
});

test('nothing has quietly adopted the data router', () => {
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
    'the data router is in use. GHSA-qwww-vcr4-c8h2 is closed by react-router 8, ' +
    'so this is no longer an advisory question — but it is still a change of ' +
    'architecture, and the RSC surface that advisory was about is reachable ' +
    'from here. Worth a deliberate decision rather than a drive-by import:\n  ' +
    offenders.join('\n  '),
  );
});
