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
