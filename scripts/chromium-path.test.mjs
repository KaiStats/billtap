/**
 * The browser the suites actually launch.
 *
 * Every browser-driving script used to read PLAYWRIGHT_CHROMIUM_PATH inline. That
 * worked, but it meant the only way to run the suite on a machine whose Chromium sat
 * under a build number Playwright did not expect was to know the variable existed and
 * set it by hand — and where the download host is blocked, `playwright install` cannot
 * repair the miss either. The result was a suite that looked unrunnable on a box with a
 * perfectly good browser on it, which is how a green local run and a skipped CI run end
 * up telling two different stories.
 *
 * So the assertions are about the two things that decay: that the explicit override
 * still wins (it is the documented escape hatch, and silently ignoring it would be
 * worse than never having had it), and that no script goes back to reading the
 * environment directly, which is the drift that would strand the next environment.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = new URL('..', import.meta.url).pathname;

/** Scripts that drive a real browser, and so must resolve one the same way. */
const BROWSER_SCRIPTS = ['prerender.mjs', 'ui.browser.mjs', 'boundaries.e2e.mjs'];

/** Resolve in a child process, so each case gets a clean environment. */
const resolveWith = (env) =>
  execFileSync(
    process.execPath,
    ['-e', "import('./scripts/chromium-path.mjs').then(m => process.stdout.write(String(m.chromiumPath())))"],
    { cwd: REPO, env: { ...process.env, ...env }, encoding: 'utf8' },
  );

test('an explicit override is honoured exactly, not second-guessed', () => {
  // Deliberately a path that does not exist: the override is a statement about
  // where the browser is, and verifying it here would just duplicate the launch.
  const override = '/nowhere/chrome';
  assert.equal(resolveWith({ PLAYWRIGHT_CHROMIUM_PATH: override }), override);
});

test('with no override, a resolved path is one that exists', () => {
  const resolved = resolveWith({ PLAYWRIGHT_CHROMIUM_PATH: '' });
  // "undefined" means "let Playwright decide", which is a valid answer.
  if (resolved === 'undefined') return;
  assert.ok(
    existsSync(resolved),
    `resolved ${resolved}, which is not on disk — the fallback would hand Playwright a dead path`,
  );
});

test('every browser-driving script resolves through the shared helper', () => {
  for (const name of BROWSER_SCRIPTS) {
    const source = readFileSync(join(REPO, 'scripts', name), 'utf8');
    assert.match(
      source,
      /executablePath: chromiumPath\(\)/,
      `${name} does not resolve its browser through chromium-path.mjs`,
    );
    assert.doesNotMatch(
      source,
      /process\.env\.PLAYWRIGHT_CHROMIUM_PATH/,
      `${name} reads PLAYWRIGHT_CHROMIUM_PATH directly, bypassing the fallback for environments whose Chromium sits elsewhere`,
    );
  }
});
