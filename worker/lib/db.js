/**
 * Supabase access from the Worker, behind the interface base44.js already had.
 *
 * ── Why the interface is copied rather than improved ────────────────────────
 *
 * Every one of the nine business functions in worker/routes/functions.js goes
 * through `serviceRole(env).entity('Session').filter(...)`. That is the money
 * code: the claim merge, the proportional tax split, the host-key check on
 * confirming a payment, the participant scope on what one diner may see of
 * another. It is mutation-tested — deliberately broken to prove the tests catch
 * it — and it is the last code in this app that should be rewritten during an
 * infrastructure migration.
 *
 * So this presents `entity(name).{filter, list, create, update}` exactly as
 * base44.js does, and those functions move across unchanged. Swapping the
 * import is the whole migration for them. Better-shaped queries can come later,
 * one at a time, with the tests already in place to catch a mistake.
 *
 * ── Two identities, same as before ──────────────────────────────────────────
 *
 * `serviceRole(env)` uses SUPABASE_SERVICE_ROLE_KEY and bypasses row level
 * security. It is what the Worker uses for work a caller is entitled to have
 * done on their behalf but not to do directly — writing a GuestRating without
 * being able to read anyone else's.
 *
 * `asCaller(env, request)` forwards the caller's own Supabase JWT, so Postgres
 * applies the policies it would have applied to the browser. Use it to ask who
 * someone is, and for writes that should be attributed to a real user.
 *
 * Reaching for serviceRole where asCaller would do is how an authorization bug
 * gets written. Under Base44 that distinction was the whole security model;
 * here the Worker's own checks carry more of the weight, which makes it easier
 * to be careless. Do not be.
 */

/** Base44 entity names to Postgres tables. */
const TABLES = {
  Session: 'sessions',
  Restaurant: 'restaurants',
  GuestRating: 'guest_ratings',
  GuestContact: 'guest_contacts',
  RestaurantLead: 'restaurant_leads',
  Waitlist: 'waitlist',
  Receipt: 'receipts',
};

export class DbError extends Error {
  constructor(status, body) {
    const detail = typeof body === 'string' ? body : JSON.stringify(body || {});
    super(`Supabase ${status}: ${detail.slice(0, 200)}`);
    this.status = status;
    this.body = body;
  }
}

export function supabaseUrl(env) {
  const raw = env?.SUPABASE_URL;
  if (!raw) throw new Error('SUPABASE_URL is not configured');
  return String(raw).trim().replace(/\/+$/, '');
}

function table(name) {
  const mapped = TABLES[name];
  if (!mapped) throw new Error(`Unknown entity "${name}" — add it to TABLES in worker/lib/db.js`);
  return mapped;
}

/**
 * Base44 ordering strings to PostgREST's.
 *
 * '-created_date' means newest first there; here that is
 * 'created_date.desc'. Getting this backwards silently returns the oldest
 * twenty sessions on a dashboard that says "recent", which is the kind of wrong
 * that looks right.
 */
function order(spec) {
  if (!spec) return null;
  const descending = spec.startsWith('-');
  const column = descending ? spec.slice(1) : spec;
  return `${column}.${descending ? 'desc' : 'asc'}`;
}

async function request(env, { path, method = 'GET', body, headers = {}, prefer, apikey }) {
  const url = `${supabaseUrl(env)}/rest/v1${path}`;

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      // PostgREST needs the project key in apikey even when Authorization
      // carries a user's JWT, or the request is rejected before any policy is
      // consulted.
      //
      // Passed in, never guessed. It used to fall back to the service role key
      // whenever one was configured, which meant a caller-scoped request
      // carried the service key in a header — and if Authorization were ever
      // dropped, the request would quietly execute with full database access
      // instead of failing. asCaller sends the anon key and only ever the anon
      // key.
      apikey: apikey || '',
      ...(prefer ? { Prefer: prefer } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!res.ok) throw new DbError(res.status, parsed);
  return parsed;
}

function entityApi(env, authHeaders, apikey) {
  const call = (opts) =>
    request(env, { ...opts, apikey, headers: { ...authHeaders, ...(opts.headers || {}) } });

  return (name) => {
    const from = table(name);

    return {
      /**
       * Rows matching every key in `query`. Returns an array, as base44.js did,
       * so ported code reads the same and a reviewer can diff the two.
       */
      async filter(query = {}) {
        const params = new URLSearchParams({ select: '*' });
        for (const [column, value] of Object.entries(query)) {
          // eq. is exact match. Values are sent as parameters, not interpolated
          // into SQL — PostgREST parses them, so there is no injection surface
          // here, but keep it that way if this ever grows an or/like clause.
          params.append(column, `eq.${value}`);
        }
        const rows = await call({ path: `/${from}?${params}` });
        return Array.isArray(rows) ? rows : [];
      },

      /**
       * `offset` exists for the nightly backup. Without it a caller can only
       * ever see the first page, which is how the old backup silently captured
       * the most recent 200 rows of each entity and looked plausible doing it.
       */
      async list(spec, limit, offset) {
        const params = new URLSearchParams({ select: '*' });
        const ordering = order(spec);
        if (ordering) params.set('order', ordering);
        if (limit) params.set('limit', String(limit));
        if (offset) params.set('offset', String(offset));
        const rows = await call({ path: `/${from}?${params}` });
        return Array.isArray(rows) ? rows : [];
      },

      /** Returns the created row, matching what base44.js returned. */
      async create(data) {
        const rows = await call({
          path: `/${from}`,
          method: 'POST',
          body: data,
          prefer: 'return=representation',
        });
        return Array.isArray(rows) ? rows[0] : rows;
      },

      /** Returns the updated row. */
      async update(id, data) {
        const rows = await call({
          path: `/${from}?id=eq.${encodeURIComponent(id)}`,
          method: 'PATCH',
          body: data,
          prefer: 'return=representation',
        });
        return Array.isArray(rows) ? rows[0] : rows;
      },
    };
  };
}

/** Acts as the app. Bypasses row level security — see the header before using. */
export function serviceRole(env) {
  const key = env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  return { entity: entityApi(env, { Authorization: `Bearer ${key}` }, key) };
}

/**
 * Acts as whoever made this request, by forwarding their Supabase JWT.
 *
 * The browser holds the token from Supabase Auth and sends it as a bearer.
 * Passing it through means Postgres applies the same policies it would have
 * applied to the browser.
 */
export function asCaller(env, request_) {
  const headers = {};
  const auth = request_?.headers?.get('authorization');
  if (auth) headers.Authorization = auth;
  // The anon key, never the service role key — see the note in request().
  return { entity: entityApi(env, headers, env?.SUPABASE_ANON_KEY), headers };
}

/**
 * The signed-in user, or null.
 *
 * Null is the ordinary case, not a failure: guests are the whole premise of
 * this product, so every caller has to handle it rather than treating it as an
 * error. That has not changed with the database underneath.
 *
 * Verified by asking Supabase rather than by checking the signature locally.
 * One round trip, and it is always right — a locally verified token that has
 * been revoked still looks valid. If this shows up in a latency profile, verify
 * the JWT against SUPABASE_JWT_SECRET here and keep this as the fallback.
 */
export async function currentUser(env, request_) {
  const auth = request_?.headers?.get('authorization');
  if (!auth) return null;

  try {
    const res = await fetch(`${supabaseUrl(env)}/auth/v1/user`, {
      headers: { Authorization: auth, apikey: env?.SUPABASE_ANON_KEY || '' },
    });
    if (!res.ok) return null;
    const user = await res.json();
    return user?.id ? user : null;
  } catch {
    return null;
  }
}

export { TABLES };
