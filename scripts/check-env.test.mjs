/**
 * The build gate, and where it looks for its configuration.
 *
 * .env.example says "copy to .env.local". The gate read process.env only, so a
 * correctly filled-in .env.local failed the check and the only way past was to
 * retype the variables in front of every build command. A gate that tests a
 * different configuration than the build it guards is not guarding anything.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = new URL('..', import.meta.url).pathname;

/**
 * Runs the real checker with its working directory in a scratch folder.
 *
 * The script stays where it is, so `import { loadEnv } from 'vite'` resolves
 * against the repo's node_modules, while loadEnv reads process.cwd() — which is
 * the scratch folder. That is the whole mechanism under test.
 *
 * A scratch folder rather than the repo itself because this writes .env.local,
 * and a test that left one behind would silently change every later build on
 * the machine.
 */
function check(envLocal, extraEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'billtap-env-'));
  try {
    if (envLocal !== null) writeFileSync(join(dir, '.env.local'), envLocal);
    const out = execFileSync(process.execPath, [join(REPO, 'scripts/check-env.mjs')], {
      cwd: dir,
      // A bare environment: the point is what the files supply, and inheriting
      // the developer's own VITE_ vars would make the result depend on whose
      // machine it ran on.
      env: { PATH: process.env.PATH, ...extraEnv },
      encoding: 'utf8',
    });
    return { ok: true, out };
  } catch (error) {
    return { ok: false, out: `${error.stdout || ''}${error.stderr || ''}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Everything a production build now requires. */
const COMPLETE = [
  'VITE_ENVIRONMENT=production',
  'VITE_BASE44_APP_ID=abc123',
  'VITE_SUPABASE_URL=https://p.supabase.co',
  'VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.sig',
].join('\n');

test('a filled-in .env.local satisfies the gate, as .env.example promises', () => {
  const result = check(`${COMPLETE}\n`);
  assert.ok(result.ok, result.out);
  assert.match(result.out, /production/);
});

test('a production build with no way to sign in is refused', () => {
  // Operators would reach a "sign-in is not available" panel and nothing else
  // would report a problem — guests are unaffected, so the site looks healthy
  // while every dashboard is unreachable.
  const result = check('VITE_ENVIRONMENT=production\nVITE_BASE44_APP_ID=abc123\n');
  assert.equal(result.ok, false);
  assert.match(result.out, /VITE_SUPABASE_URL is empty/);
});

test('the service role key in a VITE_ variable is refused outright', () => {
  // The worst available mistake in this repo: that key bypasses row level
  // security, and every VITE_ variable ships to every browser that loads the
  // page. Refused in all environments, not just production.
  const result = check([
    'VITE_ENVIRONMENT=development',
    'VITE_SUPABASE_URL=https://p.supabase.co',
    'VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig',
  ].join('\n'));
  assert.equal(result.ok, false);
  assert.match(result.out, /service_role/);
  assert.match(result.out, /bypasses row level security/);
});

test('an explicit variable overrides a stale .env.local, matching vite', () => {
  // The dangerous direction. If the file won, an explicit
  // `VITE_ENVIRONMENT=production npm run build:static` could silently ship a
  // bundle built as development.
  //
  // vite's loadEnv is what guarantees this, not the spread in check-env.mjs —
  // mutating that spread's order changes nothing. Tested through the real
  // script anyway, because the guarantee is what matters and it would break the
  // same way if loadEnv's behaviour ever changed.
  const result = check(
    COMPLETE.replace('VITE_ENVIRONMENT=production', 'VITE_ENVIRONMENT=development'),
    { VITE_ENVIRONMENT: 'production' },
  );
  assert.ok(result.ok, result.out);
  assert.match(result.out, /env-check: production/);
});

test('no configuration anywhere still fails, and says where to put it', () => {
  const result = check(null);
  assert.equal(result.ok, false);
  assert.match(result.out, /VITE_ENVIRONMENT is not set/);
  assert.match(result.out, /\.env\.local/);
});

test('a production build with no app id is still refused from a file', () => {
  // The check that caught the real deploy: every API call would 404 while the
  // prerendered marketing pages carried on looking healthy.
  const result = check('VITE_ENVIRONMENT=production\n');
  assert.equal(result.ok, false);
  assert.match(result.out, /VITE_BASE44_APP_ID is empty/);
});

test('a non-production build pointed at the production app is refused from a file', () => {
  const result = check('VITE_ENVIRONMENT=staging\nVITE_BASE44_APP_ID=prod_app\nPRODUCTION_APP_ID=prod_app\n');
  assert.equal(result.ok, false);
  assert.match(result.out, /must not share a database/);
});
