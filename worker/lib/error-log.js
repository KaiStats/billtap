/**
 * The private half of the error split: everything the caller must not see.
 *
 * worker/lib/errors.js decides what goes on a stranger's screen — a sentence
 * and a six-character id, nothing else. This is where the rest goes: the stack,
 * the route and method, which browser session was in front of it, the shape of
 * the request, and how bad it was. Same failure, two audiences, and the only
 * thing they share is the id that joins them.
 *
 * ── Why a table when there are already two other places ─────────────────────
 *
 * Cloudflare Workers Logs has all of it and keeps it for days. Sentry has the
 * 5xx for months, but only when a DSN is bound and only with the context that
 * is safe to hand a third party. Neither answers "every 4xx on
 * /api/fn/joinSession last Tuesday evening" — which is what a restaurant's
 * report turns into — and neither retains ninety days. This does, in the
 * database the app already runs on. See supabase/migrations/0008_error_log.sql.
 *
 * ── What is deliberately not written ────────────────────────────────────────
 *
 * The raw request body. The ask was to capture request input, and on this app
 * the input is a receipt: names, orders, amounts. Copying it into a ninety-day
 * table would rebuild exactly the data worker/routes/retention.js exists to
 * strip out of sessions at thirty days, and it would do it in the one table
 * whose whole purpose is to be read later by a human. So `summarise()` records
 * the SHAPE of the input — which fields arrived, what type and how big — plus
 * an allow-list of scalars that are diagnostic rather than personal.
 *
 * Also absent: the caller's IP, in favour of the session reference the browser
 * already sends; and any header, because Authorization is one.
 *
 * ── It cannot fail the request ──────────────────────────────────────────────
 *
 * This runs while something is already wrong. No credentials is a silent no-op.
 * The insert goes through waitUntil when there is a ctx. Nothing here throws,
 * and a rejected fetch is swallowed — a logger that turns a handled 400 into an
 * unhandled rejection has made the incident worse than the bug.
 */

import { fetchWithTimeout, TIMEOUTS } from './http.js';

/**
 * Fields worth keeping verbatim. Diagnostic, not personal.
 *
 * `name` was on this list and had to come off. On most codebases it is a
 * function or a route; on this one it is the diner's name and the name of what
 * they ordered — so a failed createSession wrote "Steak frites" and a table's
 * first names into a ninety-day table, through the very allow-list added to
 * keep them out. Caught by the test in worker/boundaries.boundary.test.js,
 * which is why that test asserts on real receipt content rather than on the
 * shape of the output.
 */
const SCALAR_ALLOW = new Set([
  'split_mode', 'status', 'action', 'deep',
  'quantity', 'limit', 'offset', 'page', 'version',
]);

/** Never recorded, even as a length. */
const NEVER = new Set([
  'host_key', 'participant_key', 'password', 'token', 'qr_token',
  'authorization', 'apikey', 'secret', 'image', 'image_url',
]);

/**
 * The shape of an input, not its contents.
 *
 * A string becomes its length. An array becomes its length. An object becomes
 * its key count. A scalar on the allow-list survives as itself, because
 * "split_mode was 'even'" is a diagnosis and "the fourth diner is called Priya"
 * is not.
 */
export function summarise(body, depth = 0) {
  if (body === null || body === undefined) return {};
  if (typeof body !== 'object' || Array.isArray(body)) return { type: typeof body };

  const out = {};
  for (const [key, value] of Object.entries(body)) {
    const lower = key.toLowerCase();
    if (NEVER.has(lower)) { out[key] = '[withheld]'; continue; }

    if (value === null || value === undefined) { out[key] = null; continue; }
    if (typeof value === 'boolean') { out[key] = value; continue; }
    if (typeof value === 'number') {
      out[key] = SCALAR_ALLOW.has(lower) ? value : `number(${String(value).length} digits)`;
      continue;
    }
    if (typeof value === 'string') {
      out[key] = SCALAR_ALLOW.has(lower) && value.length <= 40 ? value : `string(${value.length})`;
      continue;
    }
    if (Array.isArray(value)) {
      // One level of shape for the array's first element, because "items was 30
      // objects with 5 keys" is the difference between a malformed receipt and
      // an oversized one.
      out[key] = depth < 1
        ? { array: value.length, of: summarise(value[0], depth + 1) }
        : { array: value.length };
      continue;
    }
    out[key] = depth < 1 ? summarise(value, depth + 1) : { keys: Object.keys(value).length };
  }
  return out;
}

/** warn is the caller's mistake, error is ours, fatal escaped every handler. */
export function severityOf(error, status) {
  if (error?.name === 'AppError' && error.status < 500) return 'warn';
  if (error?.name === 'AppError') return 'error';
  return status >= 500 ? 'fatal' : 'error';
}

/**
 * Which browser session this was, when the browser said.
 *
 * src/api/functions.js sends X-BillTap-Participant on the endpoints a whole
 * table hits at once. It is a claim, not an identity — the Worker trusts it for
 * nothing — but for grouping one person's failures across a meal it is exactly
 * right, and it is not an address, so it does not turn this table into a record
 * of who ate where.
 */
function sessionRef(request) {
  const claimed = request?.headers?.get('X-BillTap-Participant');
  return typeof claimed === 'string' && claimed ? claimed.slice(0, 64) : null;
}

/** The row, built and bounded. Exported so a test can assert on it directly. */
export function buildRow(error, { id, route, method, request, body, env, status }) {
  const resolved = status ?? (error?.name === 'AppError' ? error.status : 500);
  return {
    request_id: id || null,
    // The path, never the URL: a query string on this app carries session ids.
    route: String(route || 'unknown').slice(0, 200),
    method: method || request?.method || null,
    severity: severityOf(error, resolved),
    status: resolved,
    code: error?.name === 'AppError' ? error.code : 'internal',
    // Bounded: a driver's message can be a page long, and this column is read
    // in a list view.
    message: String(error?.message || error || '').slice(0, 1000),
    // The whole point of the private layer. Trimmed to the frames that identify
    // the failure rather than the whole runtime.
    stack: error?.stack ? String(error.stack).split('\n').slice(0, 20).join('\n').slice(0, 4000) : null,
    session_ref: sessionRef(request),
    input: summarise(body),
    environment: env?.ENVIRONMENT || 'unknown',
  };
}

/**
 * Write one row. Returns true when an insert was dispatched.
 *
 * Straight to PostgREST rather than through db.js, for the same reason
 * worker/lib/audit.js does it: db.js throws on a non-2xx, and this must not.
 */
export function recordError(env, ctx, error, context = {}) {
  const rawUrl = env?.SUPABASE_URL;
  const key = env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!rawUrl || !key) return false;

  try {
    // Normalize URL: strip trailing slashes to avoid double-slash in path
    const url = String(rawUrl).trim().replace(/\/+$/, '');
    const row = buildRow(error, { ...context, env });

    const write = fetchWithTimeout(
      `${url}/rest/v1/error_log`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: key,
          Authorization: `Bearer ${key}`,
          // Nothing reads the inserted row, and asking for it back doubles the
          // response for no purpose.
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(row),
      },
      TIMEOUTS.audit,
    ).catch(() => {
      // The table not existing yet — migration 0008 unapplied on a fresh
      // database — must not be an error inside an error.
    });

    if (ctx?.waitUntil) ctx.waitUntil(write);
    return true;
  } catch {
    return false;
  }
}
