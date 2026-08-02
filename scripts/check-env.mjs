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
 */

const ENVIRONMENTS = ['production', 'staging', 'development'];

const argv = process.argv.slice(2);
const expectedIndex = argv.indexOf('--env');
const expected = expectedIndex >= 0 ? argv[expectedIndex + 1] : null;

const problems = [];
const notes = [];

const raw = (process.env.VITE_ENVIRONMENT || '').trim().toLowerCase();
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

const appId = (process.env.VITE_BASE44_APP_ID || '').trim().replace(/^app_/, '');
const productionAppId = (process.env.PRODUCTION_APP_ID || '').trim().replace(/^app_/, '');

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

// Cheap and worth it: a live Stripe key is distinguishable by prefix, so this
// needs no knowledge of what production's key actually is.
for (const name of ['STRIPE_SECRET_KEY', 'VITE_STRIPE_PUBLISHABLE_KEY']) {
  const value = process.env[name] || '';
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
