/**
 * Reading the error log back, filtered.
 *
 * The table (supabase/migrations/0008_error_log.sql) is indexed on the three
 * axes the operations policy names — date, route, severity — and can be queried
 * with SQL from the Supabase dashboard by anyone who has that access. This
 * endpoint exists for the people who do not: an on-call engineer with a phone
 * and a request id, at the moment a restaurant is on the line.
 *
 * ── Why this is guarded by its own secret ───────────────────────────────────
 *
 * Every row here is a stack trace, a route and a failure — which is to say a
 * map of where this application breaks, assembled and indexed for whoever
 * finds it. The public error handler spends real effort keeping exactly this
 * out of a browser; publishing it behind a guessable path would undo all of it.
 *
 * ERROR_LOG_READ_KEY, not the Supabase service-role key: a read credential that
 * can be handed to an on-call rotation and rotated afterwards must not also be
 * the credential that can rewrite every table in the database. Unset means the
 * endpoint answers 404 — not 401 — because an endpoint that announces itself as
 * "here, but you need a key" is an invitation to look for the key.
 */

import { fetchWithTimeout, TIMEOUTS } from '../lib/http.js';

/** Timing-safe, because a bearer check that leaks its progress is not a check. */
function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const SEVERITIES = new Set(['warn', 'error', 'fatal']);

/** An ISO date or datetime, and nothing else that could reach PostgREST. */
const ISO = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?)?$/;

/**
 * Turn the query string into a PostgREST query.
 *
 * Every value is validated against a shape before it is used, and nothing is
 * interpolated raw. That is the same lesson as the `in.(...)` injection found
 * in the retention sweep: PostgREST parameters are a query language, and a
 * caller-supplied string in one is a caller-supplied clause.
 *
 * Exported so a test can assert on what would be sent without a network.
 */
export function buildQuery(params) {
  const q = new URLSearchParams();
  q.set('select', 'id,at,request_id,route,method,severity,status,code,message,session_ref,input,environment');
  q.set('order', 'at.desc');

  const since = params.get('since');
  if (since) {
    if (!ISO.test(since)) throw new Error('since must be an ISO date');
    q.append('at', `gte.${since}`);
  }

  const until = params.get('until');
  if (until) {
    if (!ISO.test(until)) throw new Error('until must be an ISO date');
    q.append('at', `lte.${until}`);
  }

  const severity = params.get('severity');
  if (severity) {
    if (!SEVERITIES.has(severity)) throw new Error('severity must be warn, error or fatal');
    q.append('severity', `eq.${severity}`);
  }

  const route = params.get('route');
  if (route) {
    // A prefix match, because "everything under /api/fn/" is the question, and
    // a bounded character set so the wildcard cannot become a clause.
    if (!/^[\w/.:-]{1,200}$/.test(route)) throw new Error('route contains unexpected characters');
    q.append('route', `like.${route}*`);
  }

  const requestId = params.get('request_id');
  if (requestId) {
    if (!/^[0-9a-f]{4,32}$/.test(requestId)) throw new Error('request_id must be hex');
    q.append('request_id', `eq.${requestId}`);
  }

  // Capped rather than trusted. A page size read off the query string is how a
  // diagnostic endpoint becomes a way to pull the whole table in one request.
  const asked = Number(params.get('limit'));
  q.set('limit', String(Number.isFinite(asked) && asked > 0 ? Math.min(asked, 200) : 50));

  const offset = Number(params.get('offset'));
  if (Number.isFinite(offset) && offset > 0) q.set('offset', String(Math.min(offset, 100000)));

  return q;
}

const json = (data, status) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

/**
 * GET /api/error-log?since=&until=&severity=&route=&request_id=&limit=&offset=
 *
 * @param {{ request: Request, env: any }} context
 */
export async function onRequestGet({ request, env }) {
  const expected = env?.ERROR_LOG_READ_KEY;
  // Not configured is indistinguishable from not existing. See the header.
  if (!expected) return json({ error: 'Not found' }, 404);

  const offered = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!sameSecret(offered, expected)) return json({ error: 'Not found' }, 404);

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'Error log is not configured' }, 503);
  }

  let query;
  try {
    query = buildQuery(new URL(request.url).searchParams);
  } catch (error) {
    // The caller here is an engineer, so this is the one place a precise
    // message about the input is the useful answer rather than a leak.
    return json({ error: error.message }, 400);
  }

  try {
    const res = await fetchWithTimeout(
      `${env.SUPABASE_URL}/rest/v1/error_log?${query}`,
      {
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          // Total count, so a caller knows whether they are looking at all of it.
          Prefer: 'count=exact',
        },
      },
      TIMEOUTS.database,
    );

    if (!res.ok) {
      // The status, not the body: PostgREST's message names tables and columns,
      // and the point of this endpoint is not to become the leak it indexes.
      return json({ error: 'Could not read the error log', status: res.status }, 502);
    }

    const rows = await res.json();
    return json({
      rows,
      count: rows.length,
      // e.g. "0-49/1284"
      total: res.headers.get('Content-Range'),
    }, 200);
  } catch {
    return json({ error: 'Could not read the error log' }, 504);
  }
}
