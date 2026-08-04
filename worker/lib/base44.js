/**
 * Base44 REST access from the Worker.
 *
 * Exists because Base44 blocks backend functions on this app's plan — every
 * `base44.functions.invoke(...)` answers "Functions are blocked - app owner
 * lacks backend functions capability". That is nine calls covering every core
 * operation: creating a split, joining one, verifying a QR, marking paid. The
 * product could not perform a single action.
 *
 * So the logic moves here, where the same work is a plain authenticated fetch.
 *
 * worker/routes/rating-alert.js looked like precedent for this — it fetched
 * GuestRating and Restaurant over REST already. It was not: it used a host and
 * path that 404, and because it is fired best-effort from a bare catch that
 * never reads the response, it had been failing silently the whole time. The
 * shape below comes from base44-proxy.js instead, which is the path the browser
 * has been using successfully all along.
 *
 * ── Two identities, and the difference matters ──────────────────────────────
 *
 * `serviceRole(env)` acts as the app itself using BASE44_MASTER_KEY. It sees
 * and writes everything, ignoring RLS. Use it for work the caller is entitled
 * to have done on their behalf but is not entitled to do directly — writing a
 * GuestRating without being able to read anyone else's, say.
 *
 * `asCaller(env, request)` forwards the caller's own credentials, so Base44
 * applies exactly the rules it would have applied to the browser. Use it to ask
 * *who is this*, and for any write that should be attributed to a real user.
 *
 * Reaching for serviceRole when asCaller would do is how an authorization bug
 * gets written. It is the difference between "the server did this for you" and
 * "the server did this as you".
 */

/**
 * Where Base44 actually answers: `https://base44.app/api/apps/<id>/…`.
 *
 * That is the same origin and path shape worker/routes/base44-proxy.js has been
 * forwarding successfully all along, and therefore the only shape proven to work
 * against this app — every entity read the browser makes goes through it.
 *
 * Worth recording what it is not. The first version of this file used
 * `https://api.base44.com/v0/apps/<id>/…`, copied from rating-alert.js, and
 * every call came back 404 with an empty body. That path had never worked.
 * Nothing caught it because rating-alert is fired best-effort from a bare catch
 * that never reads the response, so its lookups had been failing silently for as
 * long as they existed. Copy the shape that demonstrably works, not the one
 * already written down.
 *
 * BASE44_API_ORIGIN overrides it, and is the variable the proxy already reads,
 * so the two cannot drift apart.
 */
const DEFAULT_API = 'https://base44.app';

/**
 * The app id, under either name, with an `app_` prefix stripped.
 *
 * Both names are in use — see worker/routes/rating-alert.js. The prefix strip
 * is not cosmetic: `app_69a5…` returns "App not found" from Base44 while the
 * bare id works, and that exact value spent a while in the frontend's build
 * config making every API call 404 while the prerendered marketing pages
 * carried on looking healthy.
 *
 * Two secrets hold this value and they can disagree. Normalising here means a
 * stale prefixed one cannot quietly take precedence and 404 every function.
 */
export function appId(env) {
  const raw = env.BASE44_APP_ID || env.VITE_BASE44_APP_ID || null;
  return raw ? String(raw).trim().replace(/^app_/, '') : null;
}

/** Base44's origin, shared with worker/routes/base44-proxy.js. */
export function base44Origin(env) {
  return (env.BASE44_API_ORIGIN || env.BASE44_API_BASE || DEFAULT_API).replace(/\/+$/, '');
}

/** Thrown for a non-2xx from Base44, carrying the status so callers can map it. */
export class Base44Error extends Error {
  constructor(status, body) {
    super(`Base44 ${status}: ${typeof body === 'string' ? body.slice(0, 200) : JSON.stringify(body).slice(0, 200)}`);
    this.status = status;
    this.body = body;
  }
}

async function request(env, { path, method = 'GET', body, headers = {} }) {
  const id = appId(env);
  if (!id) throw new Error('BASE44_APP_ID is not configured');

  const res = await fetch(`${base44Origin(env)}/api/apps/${id}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!res.ok) throw new Base44Error(res.status, parsed);

  // Entity reads come back either bare or wrapped in { data }. Normalise, so
  // callers never have to care which.
  return parsed && typeof parsed === 'object' && 'data' in parsed ? parsed.data : parsed;
}

/**
 * Entity operations bound to one identity.
 *
 * `filter` returns an array, matching the SDK, so ported code reads the same as
 * the Deno original and reviewers can diff the two.
 */
function entityApi(env, authHeaders) {
  const call = (opts) => request(env, { ...opts, headers: { ...authHeaders, ...(opts.headers || {}) } });

  return (name) => ({
    async filter(query = {}) {
      // An id lookup is its own endpoint; everything else is a query string.
      if (query.id && Object.keys(query).length === 1) {
        try {
          const row = await call({ path: `/entities/${name}/${encodeURIComponent(query.id)}` });
          return row ? [row] : [];
        } catch (err) {
          if (err instanceof Base44Error && err.status === 404) return [];
          throw err;
        }
      }
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) qs.set(k, String(v));
      const rows = await call({ path: `/entities/${name}?${qs}` });
      return Array.isArray(rows) ? rows : [];
    },

    /**
     * `offset` exists for the nightly backup. Without it a caller can only ever
     * see the first page, which is how the old backup silently captured the
     * most recent 200 rows of each entity and looked plausible doing it.
     */
    async list(order, limit, offset) {
      const qs = new URLSearchParams();
      if (order) qs.set('sort', order);
      if (limit) qs.set('limit', String(limit));
      if (offset) qs.set('offset', String(offset));
      const rows = await call({ path: `/entities/${name}?${qs}` });
      return Array.isArray(rows) ? rows : [];
    },

    create(data) {
      return call({ path: `/entities/${name}`, method: 'POST', body: data });
    },

    /**
     * `options` is accepted and ignored.
     *
     * db.js supports options.ifMatch — a conditional write that refuses to land
     * on a row that has moved. Base44's REST layer offers no equivalent: a PUT
     * replaces the row unconditionally and there is no compare-and-swap to ask
     * for. Silently dropping the guard would be the dangerous version of this,
     * so CONDITIONAL_WRITES below says so and patchSession falls back to a
     * weaker scheme rather than believing it has protection it does not have.
     */
    update(id, data, _options) {
      return call({ path: `/entities/${name}/${encodeURIComponent(id)}`, method: 'PUT', body: data });
    },
  });
}

/** See the note on update() above: a PUT here cannot be made conditional. */
export const CONDITIONAL_WRITES = false;

/** Acts as the app. Bypasses RLS — see the header note before using. */
export function serviceRole(env) {
  const key = env.BASE44_MASTER_KEY;
  if (!key) throw new Error('BASE44_MASTER_KEY is not configured');
  return {
    conditionalWrites: CONDITIONAL_WRITES,
    entity: entityApi(env, { Authorization: `Bearer ${key}` }),
  };
}

/**
 * Acts as whoever made this request, by forwarding their own credentials.
 *
 * The SDK talks to Base44 same-origin through worker/routes/base44-proxy.js, so
 * the cookie and any Authorization header on the inbound request are already
 * the caller's real Base44 session. Passing them straight through means Base44
 * applies the same rules it would have applied to the browser.
 */
export function asCaller(env, request_) {
  const headers = {};
  const auth = request_.headers.get('authorization');
  const cookie = request_.headers.get('cookie');
  if (auth) headers.Authorization = auth;
  if (cookie) headers.Cookie = cookie;
  return { entity: entityApi(env, headers), headers };
}

/**
 * The signed-in user, or null.
 *
 * Null is the ordinary case, not a failure: guests are the whole premise of the
 * product, so every caller has to handle it rather than treating it as an error.
 */
export async function currentUser(env, request_) {
  const { headers } = asCaller(env, request_);
  if (!headers.Authorization && !headers.Cookie) return null;
  try {
    return await request(env, { path: '/entities/User/me', headers });
  } catch {
    return null;
  }
}
