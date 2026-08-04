#!/usr/bin/env node
/**
 * Builds the bundle the browser suite runs against, with its own configuration.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * scripts/ui.browser.mjs drives the built output in dist/. Which meant it was
 * testing whatever bundle happened to be lying there — built from whatever
 * .env.local the developer happened to have.
 *
 * That is not a theoretical problem. It cost a full day: the suite passed 101/101
 * locally, where .env.local supplied Supabase configuration, and failed 14 in CI,
 * where nothing did. Same commit, same code, opposite results, and the CI failure
 * was dismissed as noise for several commits running because the local run was
 * green and believed.
 *
 * A test suite whose result depends on an untracked file is not a test suite. So
 * the configuration lives here, in the repository, identical everywhere.
 *
 * ── Why these values ────────────────────────────────────────────────────────
 *
 * They are deliberately fake and deliberately not production's. The suite stubs
 * every outbound request, so the URLs only need to be well-formed enough for the
 * app to construct its clients and for Playwright's route patterns to match.
 *
 * A real anon key here would be worse than useless: it would ship in a bundle
 * built by CI, and it would let a test accidentally reach a live database.
 */
import { spawnSync } from 'node:child_process';

/**
 * A JWT-shaped anon key.
 *
 * Shaped, not signed. scripts/check-env.mjs decodes the role claim and refuses
 * a service_role key in a VITE_ variable, so a placeholder that is not a JWT at
 * all would pass that check for the wrong reason — it would be unreadable
 * rather than verified. This decodes to {"role":"anon"} and exercises the real
 * path.
 */
const ANON = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.not-a-real-signature';

const env = {
  ...process.env,
  VITE_ENVIRONMENT: 'production',
  VITE_BASE44_APP_ID: 'uitest',
  VITE_SUPABASE_URL: 'https://uitest.supabase.co',
  VITE_SUPABASE_ANON_KEY: ANON,
  // Not a real DSN. Sentry initialises and then has nowhere to send, which is
  // what the suite wants: the reporting code runs, and no test result depends
  // on a third party being reachable.
  VITE_SENTRY_DSN: '',
};

const run = (cmd, args) => {
  const result = spawnSync(cmd, args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run('npx', ['vite', 'build']);
// Prerendered snapshots too: one test asserts the security page is in the HTML
// a crawler receives rather than only after React boots, and that file only
// exists after this step.
run('node', ['scripts/prerender.mjs']);
