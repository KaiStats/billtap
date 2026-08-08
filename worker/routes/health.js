/**
 * Is this deployment answering, and can it reach what it needs?
 *
 * ── Why there was nothing to point a monitor at ─────────────────────────────
 *
 * Availability was, until now, measured by a diner failing to split a bill and
 * a restaurant sending an email. Every check in this repo runs before a deploy;
 * nothing ran after one. A Worker that deploys cleanly and then cannot reach
 * Supabase — a rotated service-role key, a project paused for billing, an
 * outage in one region — serves 502s that are individually logged and
 * collectively unnoticed until somebody complains.
 *
 * An uptime monitor needs one URL and one number. This is that URL.
 *
 * ── The status code is the interface ────────────────────────────────────────
 *
 * 200 when the answer is yes, 503 when it is not. A monitor that has to parse a
 * body to learn something is wrong is a monitor somebody configures once,
 * incorrectly, and trusts for a year. Everything in the body is for the human
 * who arrives after the page fires.
 *
 * ── What is deliberately absent from the body ───────────────────────────────
 *
 * This endpoint is public and unauthenticated, because a health check behind a
 * credential is one a monitor cannot use and one an operator cannot curl from a
 * phone. That makes it a place where configuration leaks: a Supabase URL names
 * the project, an app id names the tenant, a version string names dependencies
 * worth attacking. So every dependency reports as a boolean and a duration, and
 * nothing here ever prints a URL, a key, an id, or an error message from
 * upstream — a Postgres error naming a column or a hostname is exactly the kind
 * of thing that ends up in a status page nobody thought was sensitive.
 */

import { backendName } from '../lib/data.js';
import { environmentName } from '../lib/environment.js';
import { fetchWithTimeout, TIMEOUTS } from '../lib/http.js';

/**
 * The shallow answer: this Worker is running and its bindings are present.
 *
 * Before: checked only env vars, cost nothing but could not detect real
 * Supabase outages (rotated key, project paused, region down). Now does
 * one fast connectivity check with a short timeout, so a monitor using
 * the default /api/health can catch infrastructure failures.
 */
async function shallow(env) {
  const backend = backendName(env);
  const configured = backend === 'supabase'
    ? Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY)
    : Boolean(env.BASE44_APP_ID && env.BASE44_MASTER_KEY);

  let reachable = true;
  if (configured && backend === 'supabase') {
    // One lightweight request with a fast timeout. Proves the service-role key
    // is still valid and Supabase is answering — enough to catch credential
    // rotations, project pauses, and outages. Uses a 3-second timeout instead
    // of the full TIMEOUTS.database (30s), so this is still cheap to call
    // every 30 seconds from a monitor.
    try {
      const res = await fetchWithTimeout(
        `${env.SUPABASE_URL}/rest/v1/restaurants?select=id&limit=1`,
        {
          headers: {
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          },
        },
        3000, // 3-second timeout, vs TIMEOUTS.database (~30s)
      );
      reachable = res.ok;
    } catch {
      // Timeout or connection failure: consider Supabase unreachable
      reachable = false;
    }
  }

  return {
    ok: configured && reachable,
    environment: environmentName(env),
    backend,
    // Booleans, not values. "Is a key present" is the operable question; which
    // key it is belongs in the dashboard, not on a public URL.
    configured,
    reachable,
  };
}

/**
 * The deep answer: the database actually replied.
 *
 * One request, for one row of the smallest table, with the same timeout budget
 * the rest of the Worker uses. Deliberately a real query rather than a ping —
 * a TCP connection to PostgREST proves nothing about whether the service-role
 * key still works, and a rotated key is the failure this is here to catch.
 *
 * Not run by default. It costs a subrequest per call, and a monitor polling a
 * deep check every thirty seconds is a monitor that becomes its own load.
 */
async function deep(env) {
  if (backendName(env) !== 'supabase') {
    return { checked: false, reason: 'not_supabase' };
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return { checked: true, ok: false, reason: 'not_configured' };
  }

  const started = Date.now();
  try {
    const res = await fetchWithTimeout(
      `${env.SUPABASE_URL}/rest/v1/restaurants?select=id&limit=1`,
      {
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      },
      TIMEOUTS.database,
    );
    return {
      checked: true,
      ok: res.ok,
      // The status, which is a number, and not the body, which is prose from
      // Postgres that can name a column or a host.
      status: res.status,
      ms: Date.now() - started,
    };
  } catch {
    // Timed out or could not connect. Both are "no" and neither message is
    // safe to publish.
    return { checked: true, ok: false, reason: 'unreachable', ms: Date.now() - started };
  }
}

/**
 * GET /api/health, and GET /api/health?deep=1.
 *
 * @param {{ request: Request, env: any }} context
 */
export async function onRequestGet({ request, env }) {
  const base = await shallow(env);
  const wantsDeep = new URL(request.url).searchParams.get('deep') === '1';

  const database = wantsDeep ? await deep(env) : { checked: false };
  const ok = base.ok && (!database.checked || database.ok !== false);

  return new Response(
    JSON.stringify({ ...base, ok, database, at: new Date().toISOString() }),
    {
      status: ok ? 200 : 503,
      headers: {
        'Content-Type': 'application/json',
        // A cached health check is a health check for whenever the cache was
        // filled, which is the one moment it is guaranteed not to be about.
        'Cache-Control': 'no-store',
      },
    },
  );
}
