#!/usr/bin/env node
/**
 * Refuses to build when the configuration would touch the wrong database.
 *
 * The runtime guards in worker/lib/environment.js catch a misconfigured Worker
 * on its first request. This catches the frontend, which has no such moment:
 * VITE_ vars are baked into the bundle at build time, so a production build
 * carrying a staging app id — or a staging build carrying production's — is
 * wrong the instant it is written and stays wrong until somebody notices which
 * bills they are looking at.
 *
 * Run by `npm run build:static` and `npm run build:ci`, ahead of vite, so a bad
 * bundle is never produced rather than produced and then rejected.
 *
 *   node scripts/check-env.mjs                  # checks VITE_ENVIRONMENT
 *   node scripts/check-env.mjs --env production # asserts it is that one
 *
 * ── Why it loads .env files itself ──────────────────────────────────────────
 *
 * .env.example says "copy to .env.local", which is the documented way to
 * configure a local build. This script used to read process.env only — so a
 * correctly filled-in .env.local failed the check, and the only way past it was
 * to prefix every build command with the variables by hand. The gate has to see
 * what vite will see, or it is testing a different build than the one that
 * ships.
 *
 * loadEnv is vite's own resolver rather than a reimplementation, so the
 * precedence rules (.env.local over .env, mode-specific over general) cannot
 * drift from the build this is guarding.
 */
import { loadEnv } from 'vite';

const ENVIRONMENTS = ['production', 'staging', 'development'];

const argv = process.argv.slice(2);
const expectedIndex = argv.indexOf('--env');
const expected = expectedIndex >= 0 ? argv[expectedIndex + 1] : null;

const problems = [];
const notes = [];

/**
 * The variables this build will actually be given.
 *
 * The '' prefix loads every variable, not just VITE_ ones, because the Stripe
 * check below looks at STRIPE_SECRET_KEY.
 *
 * loadEnv already merges process.env and gives it precedence at that prefix, so
 * an explicit `VITE_ENVIRONMENT=production npm run build:static` overrides a
 * stale .env.local — which is the direction that matters, since the other way
 * round means a deploy silently shipping the wrong bundle. The spread below
 * does not change that and is not what provides it; it is there so this line
 * still behaves if loadEnv's merging ever changes. A mutation test proved the
 * two orderings are equivalent today.
 */
const fileEnv = loadEnv(process.env.VITE_ENVIRONMENT || 'development', process.cwd(), '');
const env = { ...fileEnv, ...process.env };

const raw = (env.VITE_ENVIRONMENT || '').trim().toLowerCase();
const environment = raw || 'development';

if (raw && !ENVIRONMENTS.includes(raw)) {
  problems.push(
    `VITE_ENVIRONMENT is "${raw}", which is not one of ${ENVIRONMENTS.join(', ')}.`,
  );
}
if (!raw) {
  // Required, not defaulted. A default is how three environments ended up
  // sharing one database in the first place: everything worked without anyone
  // choosing anything, right up until `wrangler dev` wrote a row into a real
  // restaurant's bill. src/lib/environment.js still falls back to Vite's MODE
  // so `npm run dev` needs no setup, but a build that will be deployed has to
  // say what it is.
  problems.push(
    'VITE_ENVIRONMENT is not set. Set it to production, staging or development ' +
    'for this build — in Cloudflare it goes under Settings → Variables, and ' +
    'locally in .env.local.',
  );
}
if (expected && environment !== expected) {
  problems.push(
    `Expected to build the ${expected} bundle, but VITE_ENVIRONMENT says ${environment}.`,
  );
}

const appId = (env.VITE_BASE44_APP_ID || '').trim().replace(/^app_/, '');
const productionAppId = (env.PRODUCTION_APP_ID || '').trim().replace(/^app_/, '');

if (environment === 'production' && !appId) {
  problems.push(
    'VITE_BASE44_APP_ID is empty for a production build. Every API call would 404 ' +
    'while the prerendered marketing pages carried on looking healthy — which is ' +
    'exactly how that outage went unnoticed the first time.',
  );
}

if (environment !== 'production' && appId && productionAppId && appId === productionAppId) {
  problems.push(
    `This ${environment} build is pointed at the production Base44 app (${appId}). ` +
    'Development and production must not share a database.',
  );
}

// Sign-in is Supabase now. Without these two the login screen renders a "not
// available" panel instead — which is the right behaviour for a broken build
// (guests are unaffected) and the wrong thing to ship, because operators cannot
// reach their dashboards and nothing else reports a problem.
for (const name of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']) {
  if (environment === 'production' && !(env[name] || '').trim()) {
    problems.push(`${name} is empty for a production build. Operators would have no way to sign in.`);
  }
}

// The anon key is public and belongs in the bundle. The service role key
// bypasses row level security entirely, and anything prefixed VITE_ ships to
// every browser that loads the page. This is the worst single mistake available
// in this repo, and the two keys are the same length with the same prefix and
// sit next to each other on the same dashboard page.
//
// The role has to be decoded, not grepped: "service_role" lives inside the
// base64 payload, so a substring check against the raw key matches nothing and
// waves the real thing through. A test caught that.
const supabaseRole = (() => {
  const payload = String(env.VITE_SUPABASE_ANON_KEY || '').split('.')[1];
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')).role ?? null;
  } catch {
    // Supabase's newer publishable/secret keys are not JWTs. Unreadable is not
    // the same as wrong, and refusing everything unrecognisable would block a
    // project on the new format for no reason.
    return null;
  }
})();

if (supabaseRole && supabaseRole !== 'anon') {
  problems.push(
    `VITE_SUPABASE_ANON_KEY is a "${supabaseRole}" key, not the anon key. That key ` +
    'bypasses row level security and VITE_ variables ship to every browser. Use the anon key.',
  );
}

// Cheap and worth it: a live Stripe key is distinguishable by prefix, so this
// needs no knowledge of what production's key actually is.
for (const name of ['STRIPE_SECRET_KEY', 'VITE_STRIPE_PUBLISHABLE_KEY']) {
  const value = env[name] || '';
  if (environment !== 'production' && /^(sk|pk)_live_/.test(value)) {
    problems.push(`${name} is a LIVE Stripe key in a ${environment} build.`);
  }
}

const label = `env-check: ${environment}${appId ? ` · app ${appId}` : ''}`;

if (problems.length) {
  console.error(`\n✖ ${label}\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('\nSee .env.example for what each variable is and why.\n');
  process.exit(1);
}

console.log(`✔ ${label}`);
for (const note of notes) console.log(`  ${note}`);
