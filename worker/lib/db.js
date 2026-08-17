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

import { fetchWithTimeout, TIMEOUTS } from './http.js';

/** Base44 entity names to Postgres tables. */
const TABLES = {
  Session: 'sessions',
  Restaurant: 'restaurants',
  GuestRating: 'guest_ratings',
  GuestContact: 'guest_contacts',
  RestaurantLead: 'restaurant_leads',
  Waitlist: 'waitlist',
  Receipt: 'receipts',
  /**
   * A person's plan, as opposed to a restaurant's — see migration 0016. Read
   * by resolvePartyLimit to decide how many people may join one split.
   */
  Profile: 'profiles',
  /**
   * Readable, and only readable.
   *
   * Migration 0002 revokes update, delete and truncate from service_role and
   * grants it insert and select, with a trigger enforcing the same thing at the
   * row level. So this entry cannot be used to rewrite history; it exists
   * because the nightly backup could not see the table at all, which meant the
   * append-only record of who confirmed which payment was the one thing in the
   * database with no copy of it anywhere.
   */
  AuditLog: 'audit_log',
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

  const res = await fetchWithTimeout(url, {
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
       *
       * A plain value means equality. An object value is one or more PostgREST
       * operators — `{ created_date: { gte: iso } }`, `{ redacted_at: { is:
       * 'null' } }` — which is what lets a caller narrow in the database
       * instead of reading everything and filtering in the Worker.
       *
       * `options.limit` and `options.select` exist for the same reason. Both
       * are optional and both are absent from base44.js, so a caller that uses
       * them must still be correct when they are ignored — see the comment on
       * the guest-split count in createSession.
       *
       * Values are sent as query parameters, not interpolated into SQL.
       * PostgREST parses them, so there is no injection surface here; keep it
       * that way if this ever grows an or/like clause.
       */
      async filter(query = {}, { select = '*', limit, offset, order: orderSpec } = {}) {
        const params = new URLSearchParams({ select });
        for (const [column, value] of Object.entries(query)) {
          if (value && typeof value === 'object' && !Array.isArray(value)) {
            for (const [op, operand] of Object.entries(value)) {
              params.append(column, `${op}.${operand}`);
            }
          } else {
            params.append(column, `eq.${value}`);
          }
        }
        const ordering = order(orderSpec);
        if (ordering) params.set('order', ordering);
        if (limit) params.set('limit', String(limit));
        // Paged reads need a stable order to page through, which is why the
        // caller supplying `offset` is expected to supply `order` too.
        if (offset) params.set('offset', String(offset));
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

      /**
       * Returns the updated row.
       *
       * `options.ifMatch` makes the write conditional: `{ version: 7 }` appends
       * `&version=eq.7`, so Postgres evaluates the guard and the update in one
       * statement. When the row has moved on, zero rows match, the
       * representation comes back empty, and this returns null — which is the
       * caller's signal that it lost a race, not that the row is gone.
       *
       * That distinction is the whole point. Without it every mutation on a
       * session is a read-modify-write over two whole jsonb columns, and two
       * diners acting at the same moment means the second write reinstates the
       * first's stale snapshot. See supabase/migrations/0005_sessions_version.sql.
       */
      async update(id, data, { ifMatch } = {}) {
        const params = new URLSearchParams();
        params.append('id', `eq.${id}`);
        if (ifMatch) {
          for (const [column, value] of Object.entries(ifMatch)) {
            params.append(column, `eq.${value}`);
          }
        }
        const rows = await call({
          path: `/${from}?${params}`,
          method: 'PATCH',
          body: data,
          prefer: 'return=representation',
        });
        if (Array.isArray(rows)) return rows.length ? rows[0] : null;
        return rows;
      },
    };
  };
}

/**
 * Whether `update()` here honours `options.ifMatch`.
 *
 * Read by patchSession in worker/routes/functions.js to decide between a real
 * compare-and-swap and the weaker read-after-write it has to use on a backend
 * that cannot express a conditional write. Advertised as a capability rather
 * than assumed from the backend's name, so adding a third backend is a matter
 * of answering this honestly.
 */
export const CONDITIONAL_WRITES = true;

/**
 * Whether filter() here understands `{ column: { gte: value } }`, `limit` and
 * `select`.
 *
 * Same contract as CONDITIONAL_WRITES: a caller checks it and keeps a path that
 * is correct without it, because base44.js answers false and throws rather than
 * quietly returning the wrong rows.
 */
export const QUERY_OPERATORS = true;

/** Acts as the app. Bypasses row level security — see the header before using. */
export function serviceRole(env) {
  const key = env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  return {
    conditionalWrites: CONDITIONAL_WRITES,
    queryOperators: QUERY_OPERATORS,
    entity: entityApi(env, { Authorization: `Bearer ${key}` }, key),
  };
}

/**
 * Delete one object from a storage bucket.
 *
 * Here rather than in the retention job because it needs supabaseUrl() and the
 * service role key, and because the storage API is a different path prefix from
 * the REST one — /storage/v1/object/<bucket>/<key>, not /rest/v1.
 *
 * A 404 counts as success. The job runs nightly and retries whatever it did not
 * finish, so an object already gone is the expected outcome of a previous run
 * that deleted it and then failed before it could record that it had.
 */
export async function deleteObject(env, bucket, key) {
  const serviceKey = env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');

  const res = await fetchWithTimeout(
    `${supabaseUrl(env)}/storage/v1/object/${encodeURIComponent(bucket)}/${key
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
    },
    TIMEOUTS.storage,
  );

  if (res.ok || res.status === 404) return true;
  throw new DbError(res.status, await res.text());
}

/**
 * The public URL an object key is served at.
 *
 * Deterministic, which is what lets the orphan sweep ask about a whole page of
 * keys in one query instead of running a LIKE against sessions.image_url per
 * candidate — an unindexed column, so that would have been one sequential scan
 * each. Must stay in step with what supabase-js `getPublicUrl` produces, since
 * that is what src/lib/uploadReceipt.js stores.
 */
export function publicObjectUrl(env, bucket, key) {
  return `${supabaseUrl(env)}/storage/v1/object/public/${bucket}/${key}`;
}

/**
 * One page of objects in a bucket, oldest first.
 *
 * Storage has no foreign key to sessions, so an object whose split was never
 * created is unreachable from any row — there is nothing to join to. The only
 * way to find one is to walk the bucket and ask the database about each key,
 * which is what the orphan sweep in worker/routes/retention.js does.
 */
export async function listObjects(env, bucket, { limit = 100, offset = 0 } = {}) {
  const serviceKey = env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');

  const res = await fetchWithTimeout(`${supabaseUrl(env)}/storage/v1/object/list/${encodeURIComponent(bucket)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prefix: '',
      limit,
      offset,
      sortBy: { column: 'created_at', order: 'asc' },
    }),
  });

  if (!res.ok) throw new DbError(res.status, await res.text());
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

/**
 * A one-shot ticket to upload one object to one key.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * src/lib/uploadReceipt.js posts straight from the browser to Supabase Storage
 * under the anon key, because migration 0004 grants anon insert on the bucket —
 * and it has to grant something, since the person photographing the receipt is
 * a guest with no account.
 *
 * The consequence is that the upload never touches the Worker, so the rate
 * limiter in worker/lib/rate-limit.js has never seen a single one of them.
 * 0004's header says the bucket's size limit means it "cannot be used as free
 * unbounded storage"; that bounds each object at 10 MB and says nothing about
 * how many, and nothing anywhere bounds how many.
 *
 * A signed upload URL moves the authorisation decision back to us without
 * moving the bytes: the Worker mints a token — metered, rate-limited, and
 * refusable — and the browser still uploads directly to storage, so a 10 MB
 * photo does not make a round trip through a Worker isolate.
 *
 * The token is scoped to the single key it was minted for and is short-lived,
 * so it cannot be replayed against a different object or hoarded.
 */
export async function createSignedUpload(env, bucket, key) {
  const serviceKey = env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');

  const path = key.split('/').map(encodeURIComponent).join('/');
  const res = await fetchWithTimeout(
    `${supabaseUrl(env)}/storage/v1/object/upload/sign/${encodeURIComponent(bucket)}/${path}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    },
    TIMEOUTS.storage,
  );

  const text = await res.text();
  if (!res.ok) throw new DbError(res.status, text);

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new DbError(res.status, text);
  }

  // Supabase answers { url: "/object/upload/sign/<bucket>/<key>?token=..." }.
  // The token is the part supabase-js wants for uploadToSignedUrl; pull it out
  // here so the browser is never handed a URL it has to parse.
  const signed = String(parsed?.url || '');
  const token = signed.includes('token=')
    ? signed.slice(signed.indexOf('token=') + 'token='.length).split('&')[0]
    : null;
  if (!token) throw new DbError(res.status, 'signed upload response carried no token');

  return { path: key, token };
}

/**
 * The object key inside `bucket` for a public storage URL, or null.
 *
 * Returns null rather than guessing for anything that is not a URL into this
 * project's bucket. Sessions migrated from Base44 carry image_url values
 * pointing at Base44's storage, and the retention job must not attempt to
 * delete those against Supabase and count the 404 as a job well done.
 */
export function storageKeyFromUrl(url, bucket) {
  if (typeof url !== 'string' || !url) return null;
  const marker = `/storage/v1/object/public/${bucket}/`;
  const at = url.indexOf(marker);
  if (at === -1) return null;
  const key = url.slice(at + marker.length).split('?')[0];
  if (!key) return null;
  try {
    return decodeURIComponent(key);
  } catch {
    return null;
  }
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

  /**
   * The binding this cannot work without, named out loud.
   *
   * ── What this cost ─────────────────────────────────────────────────────────
   *
   * SUPABASE_ANON_KEY was never set on the production Worker. GoTrue answers a
   * request with no `apikey` header with 401 "No API key found in request" —
   * before it looks at the bearer at all — so `res.ok` was false for every
   * caller, this returned null for every caller, and every endpoint that asks
   * who someone is answered 401 to a perfectly valid session. Settings, the
   * restaurant dashboard, and the operator's own splits, all of them, for as
   * long as the binding has been missing.
   *
   * None of it was diagnosable from the outside. A signed-in operator got
   * "Unauthorized" from a screen that had already decided he was signed in,
   * and the Worker logged nothing at all, because a null here is the ordinary
   * anonymous case and is supposed to be silent.
   *
   * ── Why this is a log line and not a 500 ───────────────────────────────────
   *
   * dataMisconfiguration() in worker/lib/data.js is where a missing binding
   * becomes a refusal, and this deliberately does not go there. That check
   * gates every function in the app, so failing on the anon key would take the
   * guest half down too — and the guest half does not need it: serviceRole()
   * carries the service key as its own apikey, so a diner splitting a bill is
   * unaffected by this being absent.
   *
   * Breaking the diner at the table to surface an operator's configuration
   * problem is the exact trade shared/entitlement.js refuses to make. So the
   * failure stays scoped to the people it actually affects, and the silence —
   * which was the expensive part — is what gets fixed.
   */
  if (!env?.SUPABASE_ANON_KEY) {
    console.error(JSON.stringify({
      at: new Date().toISOString(),
      error: 'auth_unconfigured',
      message: 'SUPABASE_ANON_KEY is not set — /auth/v1/user answers 401 to every '
        + 'request without it, so every signed-in caller is treated as anonymous. '
        + 'Set it with: npx wrangler secret put SUPABASE_ANON_KEY',
    }));
    return null;
  }

  try {
    const res = await fetchWithTimeout(
      `${supabaseUrl(env)}/auth/v1/user`,
      { headers: { Authorization: auth, apikey: env?.SUPABASE_ANON_KEY || '' } },
      TIMEOUTS.auth,
    );
    if (!res.ok) return null;
    const user = await res.json();
    return user?.id ? user : null;
  } catch {
    return null;
  }
}

export { TABLES };
