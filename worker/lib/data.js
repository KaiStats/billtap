/**
 * Which database the Worker talks to, decided at runtime.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * docs/SUPABASE-MIGRATION.md says the cutover is "a configuration change in the
 * Worker, not a point of no return, and the way back is to flip that
 * configuration." That was not true as built. Choosing a backend meant editing
 * an import in three files, so switching was a deploy and rolling back was
 * another deploy — five to ten minutes, from a laptop, while a restaurant's
 * diners cannot split their bill.
 *
 * Now it is what the sentence claimed. One binding decides, so the cutover is:
 *
 *   npx wrangler secret put DATA_BACKEND     # supabase
 *
 * and the rollback is the same command with `base44`. No build, no deploy, no
 * git. Under a minute, and available to somebody who is panicking.
 *
 * ── Why default to base44 ───────────────────────────────────────────────────
 *
 * Unset means Base44 — the system holding the data today. A missing or
 * misspelled binding therefore keeps serving instead of pointing a live app at
 * an empty database, which is the failure mode worth designing against: an
 * unset variable is silent, and "no rows" reads as "no bookings" rather than as
 * "wrong database".
 *
 * ── The cost ────────────────────────────────────────────────────────────────
 *
 * Both modules are in the bundle. That is a few kilobytes on a Worker, and it
 * buys a rollback that does not need a working laptop and a git remote. Delete
 * this file and the base44 branch once Supabase has carried real traffic long
 * enough that you would have noticed a problem.
 */
import * as base44 from './base44.js';
import * as supabase from './db.js';

export const BACKENDS = { base44, supabase };

/**
 * Which one, from the environment.
 *
 * Throws on an unrecognised value rather than falling back. A typo — `supabse`,
 * `Supabase ` with a trailing space from a paste — must not silently mean
 * "carry on with the old one" during the ten minutes when somebody is watching
 * to see whether the cutover worked. Failing loudly on the first request is how
 * they find out immediately instead of an hour later.
 */
export function backendName(env) {
  const raw = (env?.DATA_BACKEND ?? '').trim().toLowerCase();
  if (!raw) return 'base44';
  if (!Object.hasOwn(BACKENDS, raw)) {
    throw new Error(
      `DATA_BACKEND is "${env.DATA_BACKEND}" — expected "base44" or "supabase". ` +
      'Refusing to guess: silently using the wrong database is how a live app ends up reading an empty one.',
    );
  }
  return raw;
}

function backend(env) {
  return BACKENDS[backendName(env)];
}

/**
 * The same three exports base44.js and db.js both provide.
 *
 * Deliberately not re-exported with `export *`: these three names are the whole
 * interface the nine business functions use, and listing them means adding a
 * fourth is a decision somebody makes on purpose rather than something that
 * appears because one module happened to export it.
 */
export const serviceRole = (env) => backend(env).serviceRole(env);
export const asCaller = (env, request) => backend(env).asCaller(env, request);
export const currentUser = (env, request) => backend(env).currentUser(env, request);

/**
 * What is missing before this Worker can reach its database, or null.
 *
 * Replaces an `if (!appId(env))` check in functions.js. That check was right
 * while Base44 was the database and becomes a bug the moment it is not: a
 * Supabase deployment has no reason to hold a Base44 app id, and the app would
 * have refused every request while looking correctly configured.
 *
 * Returns the sentence rather than a boolean because it goes into an AppError's
 * `detail`, which reaches the logs and not the caller. "Service misconfigured"
 * on its own has cost real time before — see the environment guard in
 * worker/index.js, written after a 1101 with no message.
 */
export function dataMisconfiguration(env) {
  if (backendName(env) === 'base44') {
    return base44.appId(env) ? null : 'BASE44_APP_ID is not set';
  }
  if (!env?.SUPABASE_URL) return 'DATA_BACKEND is supabase but SUPABASE_URL is not set';
  if (!env?.SUPABASE_SERVICE_ROLE_KEY) return 'DATA_BACKEND is supabase but SUPABASE_SERVICE_ROLE_KEY is not set';
  return null;
}
