/**
 * The deploy gate, checked by something other than itself.
 *
 * scripts/verify-dist.mjs is the last thing between a half-built dist/ and production,
 * and until now nothing exercised it. That is not a theoretical gap. A change to
 * scripts/prerender.mjs made every browser-launch failure write a PRERENDER-SKIPPED
 * marker and exit 0, and a matching branch here turned that marker into a pass — so the
 * gate stopped gating, and lint, typecheck, 736 unit tests, the browser suite and the
 * production build were all green while it happened. The only signal would have been a
 * wrong <title> in production, which is exactly how the original incident this file was
 * written for went unnoticed.
 *
 * So the assertions below are about refusal. Each one builds a dist/ that is broken in a
 * specific way and asserts the gate exits non-zero — because the failure mode that
 * matters is not "the gate rejects a good build", it is "the gate accepts a bad one".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PRERENDERED } from '../worker/index.js';

const REPO = new URL('..', import.meta.url).pathname;
const ROUTES = Object.entries(PRERENDERED);

/** A snapshot the gate should accept: mounted React, comfortably over the size floor. */
const goodSnapshot = (route) =>
  `<!doctype html>\n<html><head><title>${route}</title></head><body>` +
  `<div id="root"><main>${'billtap '.repeat(700)}</main></div>` +
  `</body></html>`;

/**
 * Runs the real gate against a scratch dist/ built to order.
 *
 * `files` is a map of dist-relative path -> contents, layered over whatever `snapshots`
 * asks for. VERIFY_DIST_DIR is how the script is pointed at the scratch copy; nothing in
 * the deploy path sets it.
 */
function gate({ snapshots = 'all', files = {}, args = [], env = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'billtap-dist-'));
  try {
    writeFileSync(join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
    if (snapshots === 'all') {
      for (const [route, file] of ROUTES) {
        const rel = file.replace(/^\//, '');
        mkdirSync(join(dir, rel, '..'), { recursive: true });
        writeFileSync(join(dir, rel), goodSnapshot(route));
      }
    }
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(join(dir, rel, '..'), { recursive: true });
      writeFileSync(join(dir, rel), body);
    }

    const out = execFileSync(
      process.execPath,
      [join(REPO, 'scripts/verify-dist.mjs'), ...args],
      {
        encoding: 'utf8',
        env: { PATH: process.env.PATH, VERIFY_DIST_DIR: dir, ...env },
      },
    );
    return { ok: true, out };
  } catch (error) {
    return { ok: false, out: `${error.stdout || ''}${error.stderr || ''}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a complete dist passes', () => {
  const r = gate();
  assert.ok(r.ok, r.out);
  assert.match(r.out, /verified/);
});

test('nothing built at all is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'billtap-dist-'));
  try {
    let failed = false;
    try {
      execFileSync(process.execPath, [join(REPO, 'scripts/verify-dist.mjs')], {
        encoding: 'utf8',
        env: { PATH: process.env.PATH, VERIFY_DIST_DIR: dir },
      });
    } catch {
      failed = true;
    }
    assert.ok(failed, 'an empty dist/ must not pass the gate');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing snapshot is refused', () => {
  const r = gate({ snapshots: 'none' });
  assert.ok(!r.ok, 'a dist with no snapshots passed the gate');
  assert.match(r.out, /DEPLOY BLOCKED/);
});

test('a snapshot whose React never mounted is refused', () => {
  const [route, file] = ROUTES[0];
  const r = gate({
    files: { [file.replace(/^\//, '')]: '<!doctype html><html><body><div id="root"></div></body></html>' },
  });
  assert.ok(!r.ok, `${route} shipped an empty #root`);
  assert.match(r.out, /empty #root|suspiciously thin/);
});

test('a PRERENDER-FAILED marker is refused', () => {
  const r = gate({ files: { 'PRERENDER-FAILED': 'chromium.launch() failed\n' } });
  assert.ok(!r.ok, 'a failed prerender passed the gate');
  assert.match(r.out, /prerendering failed/);
});

// ── The regression this file exists for ─────────────────────────────────────

test('a PRERENDER-SKIPPED marker alone does NOT open the gate', () => {
  // The whole hole in one assertion. prerender.mjs writes this marker, so if its
  // presence were sufficient, the process being checked would be deciding whether it
  // gets checked. It must take a deliberate opt-in in *this* process as well.
  const r = gate({ snapshots: 'none', files: { 'PRERENDER-SKIPPED': 'browser launch failed\n' } });
  assert.ok(!r.ok, 'a marker file on its own disarmed the deploy gate');
  assert.match(r.out, /PRERENDER_OPTIONAL/);
});

test('PRERENDER_OPTIONAL=1 lets a deliberate skip through, and says so', () => {
  const r = gate({
    snapshots: 'none',
    files: { 'PRERENDER-SKIPPED': 'browser launch failed\n' },
    env: { PRERENDER_OPTIONAL: '1' },
  });
  assert.ok(r.ok, r.out);
  // And it must not claim the routes are present, which the old success line did
  // unconditionally — including on the runs that checked none of them.
  assert.doesNotMatch(r.out, /prerendered routes present/);
  assert.match(r.out, /absent by choice/);
});

test('a missing referenced image is refused even when prerendering was skipped', () => {
  // The asset check used to be the last statement inside the final `else`, so any
  // earlier branch took it down with it — and the branches that skip it are the
  // unusual builds, the ones most worth checking.
  const r = gate({
    snapshots: 'none',
    files: {
      'PRERENDER-SKIPPED': 'browser launch failed\n',
      'assets/app.js': 'const hero = "/img/hero-2560.webp";',
    },
    env: { PRERENDER_OPTIONAL: '1' },
  });
  assert.ok(!r.ok, 'a 404ing asset passed the gate because prerendering was skipped');
  assert.match(r.out, /hero-2560\.webp/);
});

test('--assets-only still checks assets, and still refuses a missing one', () => {
  const r = gate({
    snapshots: 'none',
    args: ['--assets-only'],
    files: { 'assets/app.js': 'poster: "/video/product-demo.mp4"' },
  });
  assert.ok(!r.ok, 'the CI-mode gate stopped checking assets');
  assert.match(r.out, /product-demo\.mp4/);
});
