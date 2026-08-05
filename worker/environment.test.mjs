/**
 * Environment separation.
 *
 * There was none. One BASE44_APP_ID, one master key, no notion of an
 * environment anywhere — so `wrangler dev` on a laptop read and wrote the same
 * Base44 app as billtap.app, and src/main.jsx hard-coded Sentry's environment
 * to "production" so the resulting exceptions arrived in the live error feed
 * looking like a diner's.
 *
 * These pin the guards that replaced that, because the value of a guard is
 * entirely in whether it fires.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  environmentName, isProduction, assertEnvironmentIsolated,
  mayRunScheduledWork, mayContactRealPeople, ENVIRONMENTS,
} from './lib/environment.js';
import { scheduled } from './routes/nightly-backup.js';
import { sendEmail, sendSms } from './lib/email.js';

const PROD = { ENVIRONMENT: 'production', BASE44_APP_ID: 'prod_app', PRODUCTION_APP_ID: 'prod_app', BASE44_MASTER_KEY: 'k' };
const DEV = { ENVIRONMENT: 'development', BASE44_APP_ID: 'dev_app', PRODUCTION_APP_ID: 'prod_app' };

// ── Naming ──────────────────────────────────────────────────────────────────

test('an unlabelled deployment is development, never production', () => {
  // The direction of this default is the whole point. Guessing "production"
  // hands an unlabelled deploy the live database; guessing "development" costs
  // it the crons.
  assert.equal(environmentName({}), 'development');
  assert.equal(environmentName({ ENVIRONMENT: '' }), 'development');
  assert.equal(isProduction({}), false);
});

test('the environment name is read case- and whitespace-insensitively', () => {
  assert.equal(environmentName({ ENVIRONMENT: '  Production ' }), 'production');
  assert.equal(isProduction({ ENVIRONMENT: 'PRODUCTION' }), true);
});

test('an environment name nobody recognises is an error, not a guess', () => {
  assert.throws(() => environmentName({ ENVIRONMENT: 'prod' }), /not one of/);
  assert.throws(() => environmentName({ ENVIRONMENT: 'live' }), /not one of/);
});

test('the known environments are exactly the three that are configured', () => {
  assert.deepEqual([...ENVIRONMENTS].sort(), ['development', 'production', 'staging']);
});

// ── The database guard ──────────────────────────────────────────────────────

test('development pointed at the production app refuses to run', () => {
  assert.throws(
    () => assertEnvironmentIsolated({ ...DEV, BASE44_APP_ID: 'prod_app' }),
    /must not share a database/,
  );
});

test('the app_ prefix cannot smuggle production past the check', () => {
  // lib/base44.js strips that prefix before calling Base44, so app_prod_app and
  // prod_app are the same database. Comparing the raw strings would miss it.
  assert.throws(
    () => assertEnvironmentIsolated({ ...DEV, BASE44_APP_ID: 'app_prod_app' }),
    /must not share a database/,
  );
});

test('an environment with its own app id is allowed through', () => {
  assert.equal(assertEnvironmentIsolated(DEV), 'development');
  assert.equal(assertEnvironmentIsolated(PROD), 'production');
});

test('a missing app id fails loudly rather than defaulting', () => {
  assert.throws(
    () => assertEnvironmentIsolated({ ENVIRONMENT: 'staging' }),
    /BASE44_APP_ID is not set/,
  );
});

test('production must carry a master key', () => {
  assert.throws(
    () => assertEnvironmentIsolated({ ENVIRONMENT: 'production', BASE44_APP_ID: 'p' }),
    /BASE44_MASTER_KEY/,
  );
});

test('a live Stripe key outside production refuses to run', () => {
  assert.throws(
    () => assertEnvironmentIsolated({ ...DEV, STRIPE_SECRET_KEY: 'sk_live_abc' }),
    /live Stripe key/,
  );
  assert.doesNotThrow(() => assertEnvironmentIsolated({ ...DEV, STRIPE_SECRET_KEY: 'sk_test_abc' }));
  assert.doesNotThrow(() => assertEnvironmentIsolated({ ...PROD, STRIPE_SECRET_KEY: 'sk_live_abc' }));
});

// ── What only production may do ─────────────────────────────────────────────

test('scheduled work belongs to production alone', () => {
  assert.equal(mayRunScheduledWork(PROD), true);
  assert.equal(mayRunScheduledWork(DEV), false);
  assert.equal(mayRunScheduledWork({ ENVIRONMENT: 'staging' }), false);
});

test('the nightly backup does not run outside production', async () => {
  // Bound to a bucket and pointed at a database, it would still refuse: a
  // staging snapshot in the production bucket looks like a real backup.
  let wrote = false;
  const env = { ...DEV, BACKUP_BUCKET: { put: async () => { wrote = true; }, head: async () => ({}) } };
  await assert.doesNotReject(scheduled(env));
  assert.equal(wrote, false);
});

test('the nightly backup still fails loudly in production when unconfigured', async () => {
  // The failure being designed against is a backup that reports success and
  // stores nothing, so this must stay noisy.
  await assert.rejects(scheduled({ ...PROD, BASE44_MASTER_KEY: 'k' }));
});

// ── Real people ─────────────────────────────────────────────────────────────

test('email and SMS are held back outside production', async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return new Response('{}', { status: 200 }); };
  try {
    const env = {
      ...DEV,
      RESEND_API_KEY: 'k', TWILIO_ACCOUNT_SID: 's', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM_NUMBER: '+15550000000',
    };
    const mail = await sendEmail(env, { to: 'owner@example.com', subject: 'x', html: '<p>x</p>' });
    const sms = await sendSms(env, { to: '+15551234567', body: 'x' });

    assert.equal(mail.reason, 'suppressed_outside_production');
    assert.equal(sms.reason, 'suppressed_outside_production');
    assert.equal(called, false, 'nothing may leave the building');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a suppressed message reports failure rather than pretending to send', async () => {
  // Returning ok:true would make a delivery test pass in staging and fail in
  // production, which is the wrong way round.
  const held = await sendEmail(DEV, { to: 'a@b.com', subject: 's', html: 'h' });
  assert.equal(held.ok, false);
});

test('delivery can be turned on deliberately, and only deliberately', () => {
  assert.equal(mayContactRealPeople(PROD), true);
  assert.equal(mayContactRealPeople(DEV), false);
  assert.equal(mayContactRealPeople({ ...DEV, ALLOW_OUTBOUND_MESSAGES: 'true' }), true);
  assert.equal(mayContactRealPeople({ ...DEV, ALLOW_OUTBOUND_MESSAGES: 'yes' }), false,
    'only the exact opt-in counts');
});

// ── The Worker refuses to serve a misconfigured deployment ──────────────────

test('a misconfigured Worker answers with the reason instead of serving', async () => {
  const worker = (await import('./index.js')).default;
  const assets = { fetch: async () => new Response('<html>shell</html>', { status: 200, headers: { 'content-type': 'text/html' } }) };

  const res = await worker.fetch(
    new Request('https://billtap.app/'),
    { ...DEV, BASE44_APP_ID: 'prod_app', ASSETS: assets },
  );
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.match(body.detail, /must not share a database/);
});

test('a correctly configured Worker serves as normal', async () => {
  const worker = (await import('./index.js')).default;
  const assets = { fetch: async () => new Response('<html>shell</html>', { status: 200, headers: { 'content-type': 'text/html' } }) };
  const res = await worker.fetch(new Request('https://billtap.app/'), { ...DEV, ASSETS: assets });
  assert.equal(res.status, 200);
});

// ── Supabase isolation, which is the whole reason staging exists ────────────

const PROD_URL = 'https://prod.supabase.co';
const SUPA_PROD = {
  ENVIRONMENT: 'production',
  DATA_BACKEND: 'supabase',
  SUPABASE_URL: PROD_URL,
  PRODUCTION_SUPABASE_URL: PROD_URL,
  SUPABASE_SERVICE_ROLE_KEY: 'k',
};
const SUPA_STAGING = {
  ENVIRONMENT: 'staging',
  DATA_BACKEND: 'supabase',
  SUPABASE_URL: 'https://staging.supabase.co',
  PRODUCTION_SUPABASE_URL: PROD_URL,
  SUPABASE_SERVICE_ROLE_KEY: 'k',
};

test('staging pointed at the production Supabase project refuses to serve', () => {
  // Without this, "deploy to staging and walk the flow by hand" means creating
  // splits, claiming items and confirming payments inside a real restaurant's
  // live data — a rehearsal that writes to the thing it is rehearsing for.
  assert.throws(
    () => assertEnvironmentIsolated({ ...SUPA_STAGING, SUPABASE_URL: PROD_URL }),
    /production Supabase project/,
  );
});

test('the refusal says what to do about it, not just that it refused', () => {
  assert.throws(
    () => assertEnvironmentIsolated({ ...SUPA_STAGING, SUPABASE_URL: PROD_URL }),
    /Create a second Supabase project/,
  );
});

test('a trailing slash cannot smuggle production past the check', () => {
  // db.js trims trailing slashes before calling PostgREST, so these are the
  // same project. Comparing raw strings would miss it.
  assert.throws(
    () => assertEnvironmentIsolated({ ...SUPA_STAGING, SUPABASE_URL: `${PROD_URL}/` }),
    /production Supabase project/,
  );
});

test('staging on its own project is allowed through', () => {
  assert.equal(assertEnvironmentIsolated(SUPA_STAGING), 'staging');
});

test('production on the production project is obviously fine', () => {
  assert.equal(assertEnvironmentIsolated(SUPA_PROD), 'production');
});

test('a Supabase deployment is not asked for a Base44 app id', () => {
  // The same mistake this codebase already made in functions.js: refusing to
  // serve without a credential the deployment has no use for, while looking
  // correctly configured.
  assert.equal(assertEnvironmentIsolated(SUPA_STAGING), 'staging');
  assert.equal(SUPA_STAGING.BASE44_APP_ID, undefined);
});

test('production on Supabase must still carry a service role key', () => {
  const { SUPABASE_SERVICE_ROLE_KEY: _omitted, ...noKey } = SUPA_PROD;
  assert.throws(() => assertEnvironmentIsolated(noKey), /SUPABASE_SERVICE_ROLE_KEY is not set/);
});

test('a Supabase deployment with no URL fails loudly rather than calling nowhere', () => {
  assert.throws(
    () => assertEnvironmentIsolated({ ENVIRONMENT: 'staging', DATA_BACKEND: 'supabase' }),
    /SUPABASE_URL is not set/,
  );
});

test('the Base44 checks still apply while Base44 is the database', () => {
  // The backend switch must not have quietly disabled the guard that was
  // already there.
  assert.throws(
    () => assertEnvironmentIsolated({ ...DEV, BASE44_APP_ID: 'prod_app' }),
    /must not share a database/,
  );
});

// ── A guard that cannot run must say so ─────────────────────────────────────
//
// Both isolation checks were written as `productionValue && matches`, so an
// unset PRODUCTION_APP_ID or PRODUCTION_SUPABASE_URL meant the comparison was
// skipped and the deployment served.
//
// That was not hypothetical. PRODUCTION_APP_ID is described twice in
// wrangler.jsonc as committed and appears in no vars block, so the Base44 half
// had never once been able to fire — and Base44 is the live backend while
// DATA_BACKEND is unset. PRODUCTION_SUPABASE_URL was committed, but at the top
// level only, and vars are not inherited by environments, so on staging and
// development — the two deployments the check exists for — it was absent too.
//
// "Unable to check" now fails closed. A staging deploy that stops on a missing
// variable is recoverable; one that writes into a restaurant's live bills is
// not.

test('a non-production deployment refuses to serve when it cannot check the Base44 app', () => {
  assert.throws(
    () => assertEnvironmentIsolated({
      ENVIRONMENT: 'staging',
      BASE44_APP_ID: 'some-staging-app',
      // PRODUCTION_APP_ID deliberately absent — the state wrangler.jsonc was in.
    }),
    /PRODUCTION_APP_ID is not set/,
    'an uncheckable guard must stop, not shrug',
  );
});

test('a non-production deployment refuses to serve when it cannot check the Supabase project', () => {
  assert.throws(
    () => assertEnvironmentIsolated({
      ENVIRONMENT: 'staging',
      DATA_BACKEND: 'supabase',
      SUPABASE_URL: 'https://staging.supabase.co',
      // PRODUCTION_SUPABASE_URL absent — what non-inheritance produced.
    }),
    /PRODUCTION_SUPABASE_URL is not set/,
  );
});

test('production is not asked to check itself against itself', () => {
  // Production is allowed to be production. Failing closed there would take the
  // live site down over a variable that only guards other environments.
  assert.doesNotThrow(() => assertEnvironmentIsolated({
    ENVIRONMENT: 'production',
    DATA_BACKEND: 'supabase',
    SUPABASE_URL: 'https://prod.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  }));
  assert.doesNotThrow(() => assertEnvironmentIsolated({
    ENVIRONMENT: 'production',
    BASE44_APP_ID: 'prod-app',
    BASE44_MASTER_KEY: 'master-key',
  }));
});

test('a correctly configured staging deployment still serves', () => {
  assert.doesNotThrow(() => assertEnvironmentIsolated({
    ENVIRONMENT: 'staging',
    DATA_BACKEND: 'supabase',
    SUPABASE_URL: 'https://staging.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'staging-key',
    PRODUCTION_SUPABASE_URL: 'https://prod.supabase.co',
  }));
  assert.doesNotThrow(() => assertEnvironmentIsolated({
    ENVIRONMENT: 'staging',
    BASE44_APP_ID: 'staging-app',
    BASE44_MASTER_KEY: 'staging-master',
    PRODUCTION_APP_ID: 'prod-app',
  }));
});
