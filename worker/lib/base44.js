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
 * worker/routes/rating-alert.js already did exactly this against GuestRating
 * and Restaurant, so the approach was already proven in production before it
 * became the plan.
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

const DEFAULT_API = 'https://api.base44.com';

/** The app id, under either name. See worker/routes/rating-alert.js for why both. */
export function appId(env) {
  return env.BASE44_APP_ID || env.VITE_BASE44_APP_ID || null;
}

function apiBase(env) {
  return (env.BASE44_API_BASE || DEFAULT_API).replace(/\/+$/, '');
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

  const res = await fetch(`${apiBase(env)}/v0/apps/${id}${path}`, {
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

    async list(order, limit) {
      const qs = new URLSearchParams();
      if (order) qs.set('sort', order);
      if (limit) qs.set('limit', String(limit));
      const rows = await call({ path: `/entities/${name}?${qs}` });
      return Array.isArray(rows) ? rows : [];
    },

    create(data) {
      return call({ path: `/entities/${name}`, method: 'POST', body: data });
    },

    update(id, data) {
      return call({ path: `/entities/${name}/${encodeURIComponent(id)}`, method: 'PUT', body: data });
    },
  });
}

/** Acts as the app. Bypasses RLS — see the header note before using. */
export function serviceRole(env) {
  const key = env.BASE44_MASTER_KEY;
  if (!key) throw new Error('BASE44_MASTER_KEY is not configured');
  return { entity: entityApi(env, { Authorization: `Bearer ${key}` }) };
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
