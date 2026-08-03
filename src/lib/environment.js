/**
 * Which BillTap the browser is running, from the build that produced it.
 *
 * The frontend had no idea. src/main.jsx hard-coded Sentry's environment to
 * "production", so an error thrown while someone worked on their laptop landed
 * in the production feed indistinguishable from a diner's — and there was
 * nothing on screen to tell you whether the bill you were looking at was real.
 *
 * VITE_ENVIRONMENT is set per build, and scripts/check-env.mjs refuses to build
 * a deployable bundle without it — a default is how three environments came to
 * share one database, so the deploy path has to say what it is.
 *
 * The fallback to Vite's own MODE is for `npm run dev`, which should need no
 * configuration to run: MODE is "development" there. It also means a bundle
 * built by some path that skips the check still identifies itself rather than
 * being unlabelled.
 */

const RAW = (import.meta.env.VITE_ENVIRONMENT || import.meta.env.MODE || 'development')
  .trim()
  .toLowerCase();

export const ENVIRONMENT = ['production', 'staging', 'development'].includes(RAW)
  ? RAW
  : 'development';

export const IS_PRODUCTION = ENVIRONMENT === 'production';

/**
 * Which database this build talks to, in a form a person can read at a glance.
 *
 * This was the Base44 app id. It is the Supabase project ref now — the
 * subdomain of VITE_SUPABASE_URL — because that is what the question "am I
 * about to confirm a payment on real data" actually turns on. Just the ref, not
 * the URL: it goes on a badge and into a Sentry tag, and neither needs the rest.
 */
export const DATABASE_REF = (() => {
  const url = (import.meta.env.VITE_SUPABASE_URL || '').trim();
  if (!url) return '';
  try {
    return new URL(url).hostname.split('.')[0];
  } catch {
    return '';
  }
})();
