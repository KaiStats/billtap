/**
 * Make wrangler's configuration warnings fatal.
 *
 * ── Why ─────────────────────────────────────────────────────────────────────
 *
 * `wrangler deploy --dry-run --env staging` had been printing this the whole
 * time, on every run, to anyone who typed it:
 *
 *   The "env.staging" environment inherits the top-level `routes`
 *   configuration, which includes the custom domain(s): billtap.app.
 *   Deploying this environment will reassign these custom domains away from
 *   the top-level Worker.
 *
 *   The following vars exist at the top level, but not on "env.staging.vars".
 *   This is probably not what you want, since "vars" configuration is not
 *   inherited by environments: PRODUCTION_SUPABASE_URL
 *
 * Both were true, both mattered — one would have taken billtap.app off
 * production, the other had quietly disabled the check that stops a staging
 * deployment writing into a restaurant's live bills — and wrangler exits 0
 * while saying so. A warning nobody's build fails on is a warning nobody reads.
 *
 * worker/index.test.mjs asserts the specific shapes this found. This is the
 * general case: whatever wrangler decides to warn about next, the build stops.
 *
 * ── Why a dry run rather than parsing the config ───────────────────────────
 *
 * Inheritance rules are wrangler's, not ours. `routes` and `triggers` inherit;
 * `vars` and `unsafe` do not. Re-implementing that table here would mean
 * maintaining a second copy of a decision made in another repository, and being
 * wrong about it in exactly the way this exists to catch. Asking wrangler what
 * it is about to do is the only answer that stays true.
 *
 * Needs no credentials: --dry-run resolves configuration and writes a bundle to
 * a temporary directory without contacting Cloudflare.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Top level plus every declared environment. */
const TARGETS = [null, 'staging', 'development'];

/**
 * Lines that mean the configuration is wrong, not merely unusual.
 *
 * An allow-list of failures rather than "any warning": wrangler also warns
 * about `unsafe` being experimental on every single run, which is a fact about
 * the feature and not something a build should refuse over. Add to this rather
 * than inverting it — a blanket match would make the next harmless notice a
 * broken build, and the fix for that is always to delete the check.
 */
const FATAL = [
  {
    match: /inherits the top-level `routes`/,
    why: 'deploying this environment would reassign billtap.app away from production',
  },
  {
    match: /exist at the top level, but not on/,
    why: 'vars are not inherited; the environment isolation check cannot run without them',
  },
  {
    match: /"unsafe" exists at the top level, but not on/,
    why: 'the rate limiter is not inherited; this environment would have none',
  },
  {
    match: /inherits the top-level `triggers`/,
    why: 'this environment would register production\'s crons',
  },
];

/**
 * Both streams, because the warnings are on stderr.
 *
 * spawnSync rather than execFileSync: the latter returns stdout alone, and
 * every line this script exists to find is written to stderr. Scanning stdout
 * would have produced a check that passed on the exact configuration that
 * prompted it.
 */
function dryRun(env) {
  const out = mkdtempSync(join(tmpdir(), 'wrangler-check-'));
  try {
    const args = ['wrangler', 'deploy', '--dry-run', '--outdir', out];
    if (env) args.push('--env', env);
    const result = spawnSync('npx', args, {
      encoding: 'utf8',
      /**
       * A dry run executes build.command, which is scripts/verify-dist.mjs with
       * no arguments — it demands the prerendered snapshots, because a bare
       * `wrangler deploy` must not be able to ship without them.
       *
       * This check is about configuration, not about dist, and it runs in CI
       * where prerendering has not happened (it needs a browser). Relaxing that
       * one requirement for this child process keeps the two concerns apart;
       * the real deploy path never sets it.
       */
      env: { ...process.env, VERIFY_DIST_ASSETS_ONLY: '1' },
    });
    const combined = `${result.stdout || ''}\n${result.stderr || ''}`;
    if (result.status !== 0) {
      // A dry run that fails outright is itself a finding — configuration
      // wrangler cannot resolve is a deploy that will not happen.
      throw new Error(
        `wrangler could not resolve ${env || 'the top-level'} config:\n${combined.trim()}`,
      );
    }
    return combined;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

let failed = false;

for (const env of TARGETS) {
  const label = env ? `env.${env}` : 'top level';
  let output;
  try {
    output = dryRun(env);
  } catch (error) {
    console.error(`✗ ${label}: ${error.message}`);
    failed = true;
    continue;
  }

  const problems = FATAL.filter(({ match }) => match.test(output));
  if (problems.length) {
    failed = true;
    console.error(`✗ ${label}`);
    for (const { why } of problems) console.error(`    ${why}`);
  } else {
    console.log(`✓ ${label}`);
  }
}

if (failed) {
  console.error(
    '\nwrangler.jsonc has a configuration problem it was already warning about.\n' +
    'Declare routes, triggers, vars and unsafe explicitly on every environment —\n' +
    'inheritance in wrangler gives you the dangerous ones and withholds the safe ones.',
  );
  process.exit(1);
}

console.log('wrangler.jsonc verified — no environment inherits what it should not');
