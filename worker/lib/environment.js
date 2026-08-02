/**
 * Which BillTap this is, and which database it is allowed to touch.
 *
 * There was no answer to that question. One BASE44_APP_ID, one
 * BASE44_MASTER_KEY, no notion of an environment anywhere — so `wrangler dev`
 * on a laptop read and wrote the same Base44 app as billtap.app. Trying a
 * change against a receipt created live Session rows in the production
 * database, next to real restaurants' real bills, and the nightly backup would
 * dutifully snapshot them. src/main.jsx made it explicit by hard-coding
 * `environment: "production"` into Sentry, so an exception thrown on a
 * developer's laptop arrived in the production error feed indistinguishable
 * from a diner's.
 *
 * ── How separation is enforced ──────────────────────────────────────────────
 *
 * Two mechanisms, because a config convention alone is not a guarantee:
 *
 *   1. Nothing has a default. An environment must name itself and name its own
 *      app id. A deployment that says neither is treated as development and is
 *      refused the things only production may do — it does not quietly inherit
 *      production's identity, which is the failure mode worth designing out.
 *
 *   2. A non-production environment configured with production's app id throws
 *      on the first request rather than serving. PRODUCTION_APP_ID is committed
 *      in wrangler.jsonc for exactly this: app ids are not secrets — the
 *      frontend bundle has always shipped one in plain text — so recording it
 *      costs nothing and makes the check possible without anyone remembering to
 *      run it.
 *
 * Loud on purpose. A silent fallback to production is precisely the accident
 * this file exists to prevent, so every failure here is a thrown error with the
 * variable name in it, not a warning nobody reads.
 */

import { backendName } from './data.js';

export const ENVIRONMENTS = ['production', 'staging', 'development'];

/**
 * The environment name, or 'development' when unset.
 *
 * Defaulting to development rather than production is the whole point: an
 * unlabelled deploy loses the crons and the backups instead of gaining a
 * production database.
 */
export function environmentName(env) {
  const raw = (env?.ENVIRONMENT || '').trim().toLowerCase();
  if (!raw) return 'development';
  if (!ENVIRONMENTS.includes(raw)) {
    throw new Error(
      `ENVIRONMENT is "${raw}", which is not one of ${ENVIRONMENTS.join(', ')}. ` +
      'Fix wrangler.jsonc rather than guessing what it meant.',
    );
  }
  return raw;
}

export const isProduction = (env) => environmentName(env) === 'production';

/** The app id as configured, with the app_ prefix stripped. Mirrors lib/base44.js. */
function configuredAppId(env) {
  const raw = env?.BASE44_APP_ID || env?.VITE_BASE44_APP_ID || null;
  return raw ? String(raw).trim().replace(/^app_/, '') : null;
}

function normalise(value) {
  return value ? String(value).trim().replace(/^app_/, '') : null;
}

/**
 * Refuses to run at all when the configuration would touch the wrong database.
 *
 * Called on the first request rather than at module load, because a Worker that
 * throws while loading gives a 1101 with no message and nothing in the logs —
 * the point is to say what is wrong, not merely to stop.
 */
export function assertEnvironmentIsolated(env) {
  const name = environmentName(env);
  const onBase44 = backendName(env) === 'base44';

  // Only demanded while Base44 is the database. After the cutover a staging
  // deployment has no use for a Base44 app id, and refusing to serve without
  // one would take down a correctly configured environment over a credential it
  // does not need — see the same mistake, and the same fix, in
  // worker/routes/functions.js.
  if (onBase44) {
    const appId = configuredAppId(env);
    if (!appId) {
      throw new Error(
        `BASE44_APP_ID is not set for the ${name} environment. ` +
        'Set it explicitly — there is deliberately no default, because the only ' +
        'sensible default would be production.',
      );
    }

    const productionAppId = normalise(env?.PRODUCTION_APP_ID);
    if (name !== 'production' && productionAppId && appId === productionAppId) {
      throw new Error(
        `The ${name} environment is pointed at the production Base44 app ` +
        `(${appId}). Development and production must not share a database. ` +
        'Create a separate Base44 app and set BASE44_APP_ID for this environment.',
      );
    }
  }

  // The same guarantee for Supabase, and it is the whole reason a staging
  // project is worth creating.
  //
  // Without this, "deploy to staging and walk the flow by hand" means creating
  // splits, claiming items and confirming payments in a real restaurant's live
  // data — a rehearsal that writes to the thing it is rehearsing for. The URL
  // is compared rather than the key because the key is a secret this check
  // cannot know, and the project is identified by the URL anyway.
  //
  // PRODUCTION_SUPABASE_URL is committed, for the same reason PRODUCTION_APP_ID
  // is: the project ref is not a secret. It is inside every anon key, and the
  // anon key ships in the browser bundle.
  if (!onBase44) {
    // Trailing slashes stripped, because db.js strips them before calling
    // PostgREST — so https://prod.supabase.co/ and https://prod.supabase.co are
    // the same project, and a raw string comparison would wave one of them
    // through. Found by a test, not by reasoning about it.
    // normalise returns null when unset, which is the ordinary case for
    // PRODUCTION_SUPABASE_URL outside a configured deployment.
    const projectUrl = (value) => (normalise(value) || '').replace(/\/+$/, '') || null;
    const url = projectUrl(env?.SUPABASE_URL);
    if (!url) {
      throw new Error(
        `DATA_BACKEND is supabase but SUPABASE_URL is not set for the ${name} environment.`,
      );
    }
    const productionUrl = projectUrl(env?.PRODUCTION_SUPABASE_URL);
    if (name !== 'production' && productionUrl && url === productionUrl) {
      throw new Error(
        `The ${name} environment is pointed at the production Supabase project ` +
        `(${url}). Walking the flow by hand here would create splits and confirm ` +
        "payments in a real restaurant's live data. Create a second Supabase " +
        'project and set SUPABASE_URL for this environment.',
      );
    }
  }

  // A live Stripe key outside production takes real money off real cards.
  //
  // This one is checkable where the others are not: Stripe distinguishes live
  // keys from test keys by prefix, so there is no need to know production's
  // secret in order to know this is the wrong one to be holding.
  const stripeKey = String(env?.STRIPE_SECRET_KEY || '');
  if (name !== 'production' && stripeKey.startsWith('sk_live_')) {
    throw new Error(
      `The ${name} environment is holding a live Stripe key. Use a test key ` +
      '(sk_test_...) outside production — a live one charges real cards.',
    );
  }

  // The app id is the database identity, and a Base44 master key is scoped to
  // one app, so a differing app id already implies a differing key. What is
  // worth catching is the key being absent: falling back to an unauthenticated
  // call would fail later and further away, in a handler, as a 500 nobody can
  // trace back to configuration.
  if (name === 'production' && onBase44 && !env?.BASE44_MASTER_KEY) {
    throw new Error('BASE44_MASTER_KEY is not set for production.');
  }
  if (name === 'production' && !onBase44 && !env?.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set for production.');
  }

  return name;
}

/**
 * Whether this deployment may send email and SMS to real people.
 *
 * A staging deployment that fires rating-alert texts a restaurant owner's
 * actual phone at two in the morning to tell them about a one-star review that
 * a developer invented. There is no undo for that, and the Twilio account has
 * no spend cap. Outside production the messages are logged instead of sent,
 * which is nearly always what was wanted; ALLOW_OUTBOUND_MESSAGES=true is there
 * for the rare occasion someone genuinely needs to test delivery end to end.
 */
export function mayContactRealPeople(env) {
  if (isProduction(env)) return true;
  return String(env?.ALLOW_OUTBOUND_MESSAGES || '').toLowerCase() === 'true';
}

/**
 * Whether scheduled work may run here.
 *
 * The nightly backup reads every row of seven entities and writes them to R2.
 * Run from a staging deployment it either snapshots staging data into the
 * production bucket, or production data from a deployment nobody is watching.
 * Neither is a backup.
 */
export function mayRunScheduledWork(env) {
  return isProduction(env);
}
