/**
 * The Supabase data layer.
 *
 * It exists to present the interface base44.js already had, so the nine money
 * functions in worker/routes/functions.js move across unchanged. That makes
 * these tests mostly about faithfulness: the same call must produce the same
 * answer, and the places where PostgREST and Base44 differ — ordering syntax,
 * whether a write returns a row, what a miss looks like — must be smoothed over
 * here rather than surfacing in the money code.
 *
 * Runs against a stubbed PostgREST. No project, no keys, no network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { serviceRole, asCaller, currentUser, supabaseUrl, TABLES, DbError } from './lib/db.js';

const ENV = {
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  SUPABASE_ANON_KEY: 'anon-key',
};

/** Captures requests and replies with whatever the test wants. */
function stub(reply = [], status = 200) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: new URL(String(url)), method: init.method || 'GET', headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify(reply), { status, headers: { 'Content-Type': 'application/json' } });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const req = (auth) =>
  new Request('https://billtap.app/api/fn/x', { headers: auth ? { authorization: auth } : {} });

// ── Configuration ───────────────────────────────────────────────────────────

test('a missing URL or key fails loudly rather than calling nowhere', () => {
  assert.throws(() => supabaseUrl({}), /SUPABASE_URL/);
  assert.throws(() => serviceRole({ SUPABASE_URL: 'https://x.supabase.co' }), /SERVICE_ROLE_KEY/);
});

test('a trailing slash on the URL does not produce a double slash', () => {
  assert.equal(supabaseUrl({ SUPABASE_URL: 'https://proj.supabase.co///' }), 'https://proj.supabase.co');
});

test('an entity nobody mapped is an error, not a request to a table called Session', () => {
  const s = stub();
  try {
    assert.throws(() => serviceRole(ENV).entity('Nonsense'), /Unknown entity/);
  } finally { s.restore(); }
});

test('every Base44 entity the code uses has a table', () => {
  for (const name of ['Session', 'Restaurant', 'GuestRating', 'GuestContact', 'RestaurantLead', 'Waitlist', 'Receipt']) {
    assert.ok(TABLES[name], `${name} has no table`);
  }
});

// ── Reading ─────────────────────────────────────────────────────────────────

test('filter by id asks for exactly that row', async () => {
  const s = stub([{ id: 's1' }]);
  try {
    const rows = await serviceRole(ENV).entity('Session').filter({ id: 's1' });
    assert.deepEqual(rows, [{ id: 's1' }]);
    assert.equal(s.calls[0].url.pathname, '/rest/v1/sessions');
    assert.equal(s.calls[0].url.searchParams.get('id'), 'eq.s1');
  } finally { s.restore(); }
});

test('filter on several columns sends all of them', async () => {
  const s = stub([]);
  try {
    await serviceRole(ENV).entity('GuestContact').filter({ restaurant_id: 'r1', email: 'a@b.com' });
    const params = s.calls[0].url.searchParams;
    assert.equal(params.get('restaurant_id'), 'eq.r1');
    assert.equal(params.get('email'), 'eq.a@b.com');
  } finally { s.restore(); }
});

test('a miss is an empty array, not null — callers index into it', async () => {
  // Every caller does `rows[0]`. Returning null here turns a missing session
  // into a TypeError inside the money code instead of a 404.
  const s = stub([]);
  try {
    assert.deepEqual(await serviceRole(ENV).entity('Session').filter({ id: 'gone' }), []);
  } finally { s.restore(); }
});

test('a response that is not an array still yields an array', async () => {
  const s = stub({ unexpected: true });
  try {
    assert.deepEqual(await serviceRole(ENV).entity('Session').filter({ id: 'x' }), []);
  } finally { s.restore(); }
});

test('a non-2xx carries its status, so callers can map it', async () => {
  const s = stub({ message: 'nope' }, 401);
  try {
    await assert.rejects(
      () => serviceRole(ENV).entity('Session').filter({ id: 'x' }),
      (err) => err instanceof DbError && err.status === 401,
    );
  } finally { s.restore(); }
});

// ── Ordering, which is the easy thing to get backwards ──────────────────────

test('Base44 ordering translates to PostgREST', async () => {
  // '-created_date' means newest first. Getting this backwards returns the
  // OLDEST twenty sessions on a dashboard headed "recent" — wrong in a way
  // that looks right.
  const s = stub([]);
  try {
    await serviceRole(ENV).entity('Session').list('-created_date', 20);
    assert.equal(s.calls[0].url.searchParams.get('order'), 'created_date.desc');
  } finally { s.restore(); }
});

test('ascending order has no minus sign and stays ascending', async () => {
  const s = stub([]);
  try {
    await serviceRole(ENV).entity('Session').list('created_date', 5);
    assert.equal(s.calls[0].url.searchParams.get('order'), 'created_date.asc');
  } finally { s.restore(); }
});

test('list can page, which is what the nightly backup needs', async () => {
  // Without offset a backup can only ever see the first page — which is how
  // the old one silently captured the most recent 200 rows and looked
  // plausible doing it.
  const s = stub([]);
  try {
    await serviceRole(ENV).entity('Session').list('-created_date', 200, 400);
    const params = s.calls[0].url.searchParams;
    assert.equal(params.get('limit'), '200');
    assert.equal(params.get('offset'), '400');
  } finally { s.restore(); }
});

test('no ordering asked for means none sent', async () => {
  const s = stub([]);
  try {
    await serviceRole(ENV).entity('Waitlist').list(null, 10);
    assert.equal(s.calls[0].url.searchParams.get('order'), null);
  } finally { s.restore(); }
});

// ── Writing ─────────────────────────────────────────────────────────────────

test('create returns the row, not an array wrapping it', async () => {
  // base44.js returned the object. Callers do `session.id` straight away, so
  // handing back PostgREST's array would break every one of them.
  const s = stub([{ id: 'new1', title: 'Dinner' }]);
  try {
    const row = await serviceRole(ENV).entity('Session').create({ title: 'Dinner' });
    assert.deepEqual(row, { id: 'new1', title: 'Dinner' });
    assert.equal(s.calls[0].method, 'POST');
    assert.equal(s.calls[0].headers.Prefer, 'return=representation');
  } finally { s.restore(); }
});

test('update patches one row by id and returns it', async () => {
  const s = stub([{ id: 's1', status: 'claiming' }]);
  try {
    const row = await serviceRole(ENV).entity('Session').update('s1', { status: 'claiming' });
    assert.equal(row.status, 'claiming');
    assert.equal(s.calls[0].method, 'PATCH');
    assert.equal(s.calls[0].url.searchParams.get('id'), 'eq.s1');
    assert.deepEqual(s.calls[0].body, { status: 'claiming' });
  } finally { s.restore(); }
});

test('an id with characters that mean something in a URL is encoded', async () => {
  const s = stub([{ id: 'a/b+c' }]);
  try {
    await serviceRole(ENV).entity('Session').update('a/b+c', { tip: 1 });
    assert.match(s.calls[0].url.search, /id=eq\.a%2Fb%2Bc/);
  } finally { s.restore(); }
});

// ── Identity ────────────────────────────────────────────────────────────────

test('the service role signs its calls with the service key', async () => {
  const s = stub([]);
  try {
    await serviceRole(ENV).entity('Session').filter({ id: 's1' });
    assert.equal(s.calls[0].headers.Authorization, 'Bearer service-key');
    assert.equal(s.calls[0].headers.apikey, 'service-key');
  } finally { s.restore(); }
});

test('asCaller forwards the caller token and nothing of the app', async () => {
  const s = stub([]);
  try {
    await asCaller(ENV, req('Bearer user-jwt')).entity('Session').filter({ id: 's1' });
    assert.equal(s.calls[0].headers.Authorization, 'Bearer user-jwt');
    assert.ok(!JSON.stringify(s.calls[0].headers).includes('service-key'));
  } finally { s.restore(); }
});

test('asCaller on an anonymous request forwards no credential at all', () => {
  assert.deepEqual(asCaller(ENV, req()).headers, {});
});

test('currentUser costs nothing when there is nothing to send', async () => {
  const s = stub([]);
  try {
    assert.equal(await currentUser(ENV, req()), null);
    assert.equal(s.calls.length, 0, 'a guest is the ordinary case and pays no round trip');
  } finally { s.restore(); }
});

test('currentUser resolves a good token to the user', async () => {
  const s = stub({ id: 'uuid-1', email: 'host@example.com' });
  try {
    const user = await currentUser(ENV, req('Bearer good'));
    assert.equal(user.id, 'uuid-1');
    assert.match(s.calls[0].url.pathname, /\/auth\/v1\/user$/);
  } finally { s.restore(); }
});

test('currentUser returns null for a rejected token rather than throwing', async () => {
  // Guests are the premise of this product. An unauthenticated caller is not an
  // error and must not become one.
  const s = stub({ message: 'invalid' }, 401);
  try {
    assert.equal(await currentUser(ENV, req('Bearer stale')), null);
  } finally { s.restore(); }
});

test('currentUser returns null when the response has no user id', async () => {
  const s = stub({});
  try {
    assert.equal(await currentUser(ENV, req('Bearer odd')), null);
  } finally { s.restore(); }
});

test('a network failure during the identity check is a guest, not a crash', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
  try {
    assert.equal(await currentUser(ENV, req('Bearer x')), null);
  } finally { globalThis.fetch = original; }
});

// ── The premise ─────────────────────────────────────────────────────────────

test('db.js presents exactly the interface base44.js does', async () => {
  // The whole migration plan rests on this. If the shapes ever diverge, the
  // nine money functions in worker/routes/functions.js stop being a one-line
  // import swap and become a rewrite of the most dangerous code in the app.
  const base44 = await import('./lib/base44.js');
  const db = await import('./lib/db.js');

  for (const fn of ['serviceRole', 'asCaller', 'currentUser']) {
    assert.equal(typeof db[fn], 'function', `db.js is missing ${fn}`);
    assert.equal(typeof base44[fn], 'function', `base44.js is missing ${fn}`);
  }

  const fromBase44 = base44.serviceRole({ BASE44_APP_ID: 'x', BASE44_MASTER_KEY: 'k' }).entity('Session');
  const fromDb = serviceRole(ENV).entity('Session');
  assert.deepEqual(Object.keys(fromDb).sort(), Object.keys(fromBase44).sort());
});

test('the service role key never reaches a caller-scoped request', async () => {
  // It bypasses row level security entirely. It used to be sent as the apikey
  // on every request including caller-scoped ones, so a dropped Authorization
  // header would have executed with full database access instead of failing.
  const s = stub([]);
  try {
    await asCaller(ENV, req('Bearer user-jwt')).entity('Session').filter({ id: 's1' });
    const sent = JSON.stringify(s.calls[0].headers);
    assert.ok(!sent.includes('service-key'), 'the service key must not travel with a user request');
    assert.equal(s.calls[0].headers.apikey, 'anon-key');
  } finally { s.restore(); }
});

test('an anonymous caller sends the anon key and no bearer at all', async () => {
  const s = stub([]);
  try {
    await asCaller(ENV, req()).entity('Session').filter({ id: 's1' });
    assert.equal(s.calls[0].headers.apikey, 'anon-key');
    assert.equal(s.calls[0].headers.Authorization, undefined);
  } finally { s.restore(); }
});

test('with no anon key configured, a caller request still never sends the service key', async () => {
  // The dangerous shape is a fallback: apikey falling back to whatever key
  // happens to be configured means a misconfigured deployment quietly runs
  // caller requests with full database access instead of failing.
  const s = stub([]);
  try {
    const partial = { SUPABASE_URL: ENV.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: 'service-key' };
    await asCaller(partial, req('Bearer user-jwt')).entity('Session').filter({ id: 's1' });
    assert.equal(s.calls[0].headers.apikey, '', 'fail closed, not open');
    assert.ok(!JSON.stringify(s.calls[0].headers).includes('service-key'));
  } finally { s.restore(); }
});

test('a rejected identity check is rejected on its status, not on its body', async () => {
  // Relying on the body having no id means anything that returns a plausible
  // shape with a non-2xx status — a cached error, a proxy page, a 403 with a
  // stale payload — is accepted as a signed-in user.
  const s = stub({ id: 'uuid-attacker', email: 'nobody@example.com' }, 401);
  try {
    assert.equal(await currentUser(ENV, req('Bearer forged')), null);
  } finally { s.restore(); }
});
