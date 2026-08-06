/**
 * Behavioural coverage for the ported Base44 functions and the Worker's access
 * layer.
 *
 * worker/functions.test.mjs already pins the five bugs the audit found. This
 * file is the wider net: every handler, every guard, and the money arithmetic
 * that decides what each person at the table is asked to pay. A wrong number
 * here is not a rendering glitch, it is someone being overcharged in a
 * restaurant, so the shares are asserted to the cent.
 *
 * Everything runs against an in-memory stand-in for Base44 — no network, no
 * credentials, no live app. The stub answers the same REST shape
 * worker/lib/base44.js speaks, including the by-id endpoint, query filtering
 * and /entities/User/me, so the handlers exercise their real code paths rather
 * than a mock of themselves.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HANDLERS, onRequestPost } from './routes/functions.js';
import { appId, base44Origin, serviceRole, asCaller, currentUser } from './lib/base44.js';
import { LIMITED, PER_PARTICIPANT, limitKey, isLimited } from './lib/rate-limit.js';

// ── Harness ─────────────────────────────────────────────────────────────────

const MASTER = 'test-master-key';
const HOST_COOKIE = 'base44_session=host-token';

/**
 * An in-memory Base44.
 *
 * `users` maps an Authorization/Cookie value to the row /entities/User/me
 * returns, which is how a test says "this request is from the host" without
 * any real auth.
 */
function stub({ entities = {}, users = {} } = {}) {
  const store = structuredClone(entities);
  const env = { BASE44_APP_ID: 'testapp', BASE44_MASTER_KEY: MASTER, __store: store };
  const calls = [];

  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    const auth = init.headers?.Authorization || init.headers?.Cookie || null;
    calls.push({ path: u.pathname + u.search, method, auth });

    // Who am I? Answered from the caller's credential, never the master key.
    if (u.pathname.endsWith('/entities/User/me')) {
      const who = users[auth];
      return who
        ? new Response(JSON.stringify(who), { status: 200 })
        : new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const m = u.pathname.match(/\/entities\/([A-Za-z]+)(?:\/([^/]+))?$/);
    if (!m) return new Response('{}', { status: 404 });
    const [, entity, id] = m;
    const rows = store[entity] || (store[entity] = []);

    if (method === 'PUT' && id) {
      const row = rows.find((r) => r.id === decodeURIComponent(id));
      if (!row) return new Response('{}', { status: 404 });
      Object.assign(row, JSON.parse(init.body));
      return new Response(JSON.stringify(row), { status: 200 });
    }
    if (method === 'POST') {
      const row = { id: `${entity.toLowerCase()}_${rows.length + 1}`, created_date: new Date().toISOString(), ...JSON.parse(init.body) };
      rows.push(row);
      return new Response(JSON.stringify(row), { status: 200 });
    }
    if (id) {
      const row = rows.find((r) => r.id === decodeURIComponent(id));
      return row
        ? new Response(JSON.stringify(row), { status: 200 })
        : new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    }

    // Collection read with the filter's query string applied.
    let out = rows;
    for (const [k, v] of u.searchParams) {
      if (k === 'sort' || k === 'limit' || k === 'offset') continue;
      out = out.filter((r) => String(r[k]) === v);
    }
    const offset = Number(u.searchParams.get('offset')) || 0;
    const limit = Number(u.searchParams.get('limit')) || undefined;
    out = out.slice(offset, limit ? offset + limit : undefined);
    return new Response(JSON.stringify(out), { status: 200 });
  };

  return {
    env,
    store,
    calls,
    restore: () => { globalThis.fetch = original; },
  };
}

/** A Request carrying (or not carrying) a caller credential. */
const req = (cookie) =>
  new Request('https://billtap.app/api/fn/x', {
    method: 'POST',
    headers: cookie ? { cookie } : {},
  });

/** Runs `fn` with a stubbed Base44 and always restores global fetch. */
async function withStub(opts, fn) {
  const s = stub(opts);
  try {
    return await fn(s);
  } finally {
    s.restore();
  }
}

const body = async (res) => res.json();

const ALICE = 'p_1700000000000_aaa';
const BOB = 'p_1700000000001_bbb';
const CARA = 'p_1700000000002_ccc';

const HOST = { id: 'user_1', email: 'host@example.com' };

/** Enough of an environment for the Worker's isolation check to pass. */
const WORKER_ENV = {
  ENVIRONMENT: 'development',
  BASE44_APP_ID: 'test_app_dev',
  PRODUCTION_APP_ID: 'test_app_prod',
};

/** Two items, $20 + $10, no tax or tip. */
const simpleSession = () => ({
  id: 's1',
  title: 'Dinner',
  split_mode: 'itemized',
  total_amount: 30,
  tax: 0,
  tip: 0,
  status: 'waiting',
  expires_at: Date.now() + 86400000,
  items: [
    { id: 'i1', name: 'Steak', price: 20, quantity: 1, claimed_by: [] },
    { id: 'i2', name: 'Salad', price: 10, quantity: 1, claimed_by: [] },
  ],
  participants: [],
});

// ── The dispatcher ──────────────────────────────────────────────────────────

test('an unknown function name is a 404, not a crash', async () => {
  const res = await onRequestPost({ request: req(), env: { BASE44_APP_ID: 'x' }, name: 'nope' });
  assert.equal(res.status, 404);
  assert.match((await body(res)).error, /Unknown function/);
});

test('a missing app id fails closed rather than calling Base44 with "null"', async () => {
  const res = await onRequestPost({ request: req(), env: {}, name: 'validateReceiptParse' });
  assert.equal(res.status, 500);
  assert.equal((await body(res)).error, 'Service misconfigured');
});

test('an app id is still accepted with the app_ prefix that broke production', async () => {
  const request = new Request('https://billtap.app/api/fn/validateReceiptParse', {
    method: 'POST',
    body: JSON.stringify({ items: [], total: 0 }),
  });
  const res = await onRequestPost({ request, env: { BASE44_APP_ID: 'app_69a5' }, name: 'validateReceiptParse' });
  assert.equal(res.status, 200);
});

test('malformed JSON is a 400, not a 500', async () => {
  const request = new Request('https://billtap.app/api/fn/validateReceiptParse', {
    method: 'POST',
    body: '{not json',
  });
  const res = await onRequestPost({ request, env: { BASE44_APP_ID: 'x' }, name: 'validateReceiptParse' });
  assert.equal(res.status, 400);
  assert.equal((await body(res)).error, 'Invalid JSON');
});

test('an empty body is treated as {} rather than rejected', async () => {
  const request = new Request('https://billtap.app/api/fn/validateReceiptParse', { method: 'POST' });
  const res = await onRequestPost({ request, env: { BASE44_APP_ID: 'x' }, name: 'validateReceiptParse' });
  // items is absent, so the handler's own guard answers — the point is that the
  // dispatcher got that far.
  assert.equal(res.status, 400);
  assert.equal((await body(res)).error, 'Invalid items array');
});

test('a thrown handler returns a generic 500 and leaks no internals', async () => {
  const request = new Request('https://billtap.app/api/fn/getPublicRestaurant', {
    method: 'POST',
    body: JSON.stringify({ slug: 'x' }),
  });
  await withStub({}, async ({ env }) => {
    globalThis.fetch = async () => { throw new Error('BASE44_MASTER_KEY=supersecret leaked'); };
    const res = await onRequestPost({ request, env, name: 'getPublicRestaurant' });
    assert.equal(res.status, 500);
    const out = await body(res);
    // The message answers the question a diner actually has at this moment,
    // which is not "what broke" — it is "did I just pay twice".
    assert.match(out.error, /Nothing was charged or changed/);
    assert.equal(out.code, 'internal');
    assert.ok(!JSON.stringify(out).includes('supersecret'), 'an upstream message must never reach the caller');
    // Traceable. Without this the caller has a sentence and we have a log line
    // and there is no way to put the two together.
    assert.match(out.request_id, /^[0-9a-f]{6}$/);
    assert.equal(res.headers.get('X-Request-Id'), out.request_id);
  });
});

test('every handler answers with JSON that is never cached', async () => {
  const res = await onRequestPost({ request: req(), env: { BASE44_APP_ID: 'x' }, name: 'nope' });
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

// ── validateReceiptParse ────────────────────────────────────────────────────

const validate = (b) => HANDLERS.validateReceiptParse({ body: b });

test('validateReceiptParse rejects a non-array items field', async () => {
  assert.equal((await validate({ items: 'nope' })).status, 400);
  assert.equal((await validate({})).status, 400);
});

test('a receipt whose numbers agree comes back valid', async () => {
  const out = await body(await validate({
    items: [{ name: 'A', price: 10 }, { name: 'B', price: 5 }],
    tax: 1.2, tip: 3, total: 19.2,
  }));
  assert.equal(out.valid, true);
  assert.deepEqual(out.warnings, []);
  assert.equal(out.item_sum, 15);
  assert.equal(out.calculated_total, 19.2);
});

test('a total that disagrees by more than a nickel is flagged', async () => {
  const out = await body(await validate({
    items: [{ name: 'A', price: 10 }], tax: 0, tip: 0, total: 25,
  }));
  assert.equal(out.valid, false);
  assert.match(out.warnings[0], /\$10\.00.*\$25\.00/);
});

test('a rounding-sized difference is not flagged', async () => {
  const out = await body(await validate({
    items: [{ name: 'A', price: 10 }], tax: 0, tip: 0, total: 10.04,
  }));
  assert.equal(out.valid, true);
});

test('no printed total means no mismatch to report', async () => {
  const out = await body(await validate({ items: [{ name: 'A', price: 10 }] }));
  assert.equal(out.valid, true);
});

test('quantity is part of the item sum', async () => {
  const out = await body(await validate({ items: [{ name: 'Tea', price: 3.25, quantity: 3 }] }));
  assert.equal(out.item_sum, 9.75);
});

test('an item with no name is called out', async () => {
  const out = await body(await validate({ items: [{ name: '   ', price: 4 }] }));
  assert.equal(out.valid, false);
  assert.match(out.warnings.join(' '), /no name/);
});

test('an unreadable or negative price is called out', async () => {
  const neg = await body(await validate({ items: [{ name: 'A', price: -3 }] }));
  assert.match(neg.warnings.join(' '), /unreadable price/);
  const nan = await body(await validate({ items: [{ name: 'B', price: 'abc' }] }));
  assert.match(nan.warnings.join(' '), /unreadable price/);
});

test('warnings are capped so a garbage scan cannot flood the screen', async () => {
  const items = Array.from({ length: 20 }, () => ({ name: '', price: -1 }));
  const out = await body(await validate({ items }));
  assert.equal(out.warnings.length, 5);
});

test('the reported totals are rounded to cents', async () => {
  const out = await body(await validate({
    items: [{ name: 'A', price: 0.1 }, { name: 'B', price: 0.2 }], total: 0,
  }));
  assert.equal(out.item_sum, 0.3, '0.1 + 0.2 must not surface as 0.30000000000000004');
});

// ── QR tokens ───────────────────────────────────────────────────────────────

async function mintToken(overrides = {}) {
  // Owned by HOST, explicitly. This used to mint against an ownerless
  // simpleSession() and pass only because generateQRSignature re-read the row
  // through asCaller and the stub has no row level security, so it handed the
  // row to whoever asked. Against the real database that read returns nothing
  // for anyone (sessions is default-deny). The check now compares
  // created_by_id, so the fixture has to say who owns it.
  return withStub({
    entities: { Session: [{ ...simpleSession(), created_by_id: HOST.id }] },
    users: { [HOST_COOKIE]: HOST },
  }, async ({ env }) => {
    const res = await HANDLERS.generateQRSignature({
      env: { ...env, ...overrides }, request: req(HOST_COOKIE), body: { session_id: 's1' },
    });
    return { res, out: res.status === 200 ? await body(res) : null };
  });
}

test('generateQRSignature requires a session id', async () => {
  const res = await HANDLERS.generateQRSignature({ env: {}, request: req(), body: {} });
  assert.equal(res.status, 400);
});

test('an anonymous caller gets no QR token', async () => {
  await withStub({ entities: { Session: [simpleSession()] } }, async ({ env }) => {
    const res = await HANDLERS.generateQRSignature({ env, request: req(), body: { session_id: 's1' } });
    assert.equal(res.status, 401);
  });
});

test('a signed-in stranger cannot mint a token for a session they cannot see', async () => {
  // asCaller forwards their cookie; Base44's rules return nothing, so 404.
  await withStub({
    entities: { Session: [] },
    users: { 'base44_session=stranger': { id: 'user_9' } },
  }, async ({ env }) => {
    const res = await HANDLERS.generateQRSignature({
      env, request: req('base44_session=stranger'), body: { session_id: 's1' },
    });
    assert.equal(res.status, 404);
  });
});

test('a minted token has three parts and expires in thirty minutes', async () => {
  const { out } = await mintToken();
  assert.equal(out.qr_token.split('.').length, 3);
  const minutes = (out.expires_at - Date.now()) / 60000;
  assert.ok(minutes > 29 && minutes <= 30, `expiry was ${minutes} minutes out`);
});

test('a freshly minted token verifies', async () => {
  const { out } = await mintToken();
  const res = await HANDLERS.verifyQRToken({
    env: { BASE44_MASTER_KEY: MASTER }, body: { qr_token: out.qr_token },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await body(res), { valid: true, session_id: 's1' });
});

test('a tampered signature is rejected', async () => {
  const { out } = await mintToken();
  const [id, exp, sig] = out.qr_token.split('.');
  const flipped = sig.slice(0, -1) + (sig.at(-1) === 'A' ? 'B' : 'A');
  const res = await HANDLERS.verifyQRToken({
    env: { BASE44_MASTER_KEY: MASTER }, body: { qr_token: `${id}.${exp}.${flipped}` },
  });
  assert.equal(res.status, 400);
  assert.equal((await body(res)).valid, false);
});

test('pointing a valid signature at a different session is rejected', async () => {
  const { out } = await mintToken();
  const [, exp, sig] = out.qr_token.split('.');
  const res = await HANDLERS.verifyQRToken({
    env: { BASE44_MASTER_KEY: MASTER }, body: { qr_token: `s2.${exp}.${sig}` },
  });
  assert.equal((await body(res)).valid, false);
});

test('extending the expiry invalidates the token, because it is signed', async () => {
  const { out } = await mintToken();
  const [id, exp, sig] = out.qr_token.split('.');
  const res = await HANDLERS.verifyQRToken({
    env: { BASE44_MASTER_KEY: MASTER },
    body: { qr_token: `${id}.${Number(exp) + 3600000}.${sig}` },
  });
  assert.equal((await body(res)).valid, false);
});

test('an expired token is refused with a message a diner can act on', async () => {
  const env = { BASE44_MASTER_KEY: MASTER };
  // Sign an already-past expiry the same way the minter would.
  const { out } = await mintToken();
  const [id, , ] = out.qr_token.split('.');
  const past = Date.now() - 1000;
  // Any signature will do: the expiry check runs first.
  const res = await HANDLERS.verifyQRToken({ env, body: { qr_token: `${id}.${past}.sig` } });
  assert.equal(res.status, 400);
  assert.match((await body(res)).error, /expired/i);
});

test('a malformed token is refused before any crypto runs', async () => {
  const env = { BASE44_MASTER_KEY: MASTER };
  for (const bad of ['', 'onepart', 'two.parts', 'a.b.c.d']) {
    const res = await HANDLERS.verifyQRToken({ env, body: { qr_token: bad } });
    assert.equal(res.status, 400, `"${bad}" should not verify`);
  }
});

test('a non-numeric expiry is malformed, not "never expires"', async () => {
  const res = await HANDLERS.verifyQRToken({
    env: { BASE44_MASTER_KEY: MASTER }, body: { qr_token: 's1.soon.sig' },
  });
  assert.equal(res.status, 400);
  assert.match((await body(res)).error, /Malformed/);
});

test('a token signed with another secret does not verify', async () => {
  const { out } = await mintToken({ QR_SIGNING_SECRET: 'secret-a' });
  const res = await HANDLERS.verifyQRToken({
    env: { QR_SIGNING_SECRET: 'secret-b' }, body: { qr_token: out.qr_token },
  });
  assert.equal((await body(res)).valid, false);
});

test('QR_SIGNING_SECRET takes precedence over the master key', async () => {
  const { out } = await mintToken({ QR_SIGNING_SECRET: 'dedicated' });
  const withDedicated = await HANDLERS.verifyQRToken({
    env: { QR_SIGNING_SECRET: 'dedicated', BASE44_MASTER_KEY: MASTER }, body: { qr_token: out.qr_token },
  });
  assert.equal((await body(withDedicated)).valid, true);
  const withMasterOnly = await HANDLERS.verifyQRToken({
    env: { BASE44_MASTER_KEY: MASTER }, body: { qr_token: out.qr_token },
  });
  assert.equal((await body(withMasterOnly)).valid, false);
});

// ── createSession ───────────────────────────────────────────────────────────

const create = (env, request, b) => HANDLERS.createSession({ env, request, body: b });

test('a guest with no table tent cannot create a split', async () => {
  await withStub({}, async ({ env }) => {
    const res = await create(env, req(), { title: 'Dinner', items: [] });
    assert.equal(res.status, 401);
  });
});

test('a guest who scanned a table tent can, because that is the product', async () => {
  await withStub({ entities: { Restaurant: [{ id: 'r1', slug: 'joes' }] } }, async ({ env }) => {
    const res = await create(env, req(), { title: 'Table 4', items: [], restaurant_slug: 'joes' });
    assert.equal(res.status, 200);
    assert.equal((await body(res)).session.restaurant_id, 'r1');
  });
});

test('a title is required and whitespace does not count as one', async () => {
  await withStub({ users: { [HOST_COOKIE]: HOST } }, async ({ env }) => {
    assert.equal((await create(env, req(HOST_COOKIE), { items: [] })).status, 400);
    assert.equal((await create(env, req(HOST_COOKIE), { title: '   ', items: [] })).status, 400);
  });
});

test('a title is trimmed and capped at 100 characters', async () => {
  await withStub({ users: { [HOST_COOKIE]: HOST } }, async ({ env }) => {
    const res = await create(env, req(HOST_COOKIE), { title: `  ${'x'.repeat(200)}  `, items: [] });
    assert.equal((await body(res)).session.title.length, 100);
  });
});

test('negative tax or tip is refused', async () => {
  await withStub({ users: { [HOST_COOKIE]: HOST } }, async ({ env }) => {
    assert.equal((await create(env, req(HOST_COOKIE), { title: 'D', tax: -1 })).status, 400);
    assert.equal((await create(env, req(HOST_COOKIE), { title: 'D', tip: -0.01 })).status, 400);
  });
});

test('an absurd tax or tip is refused before it reaches the database', async () => {
  await withStub({ users: { [HOST_COOKIE]: HOST } }, async ({ env }) => {
    assert.equal((await create(env, req(HOST_COOKIE), { title: 'D', tax: 10001 })).status, 400);
    assert.equal((await create(env, req(HOST_COOKIE), { title: 'D', tip: 99999 })).status, 400);
  });
});

test('a bill over $10,000 is refused', async () => {
  await withStub({ users: { [HOST_COOKIE]: HOST } }, async ({ env }) => {
    const res = await create(env, req(HOST_COOKIE), {
      title: 'D', items: [{ name: 'Yacht', price: 20000, quantity: 1 }],
    });
    assert.equal(res.status, 400);
    assert.match((await body(res)).error, /10,000/);
  });
});

test('an itemized total is computed from the items, not taken from the client', async () => {
  await withStub({ users: { [HOST_COOKIE]: HOST } }, async ({ env }) => {
    const res = await create(env, req(HOST_COOKIE), {
      title: 'D',
      items: [{ name: 'A', price: 10, quantity: 2 }],
      tax: 2, tip: 3,
      total_amount: 1,           // a client claiming the bill is a dollar
      split_mode: 'itemized',
    });
    assert.equal((await body(res)).session.total_amount, 25);
  });
});

test('an even split uses the total the host typed in', async () => {
  await withStub({ users: { [HOST_COOKIE]: HOST } }, async ({ env }) => {
    const res = await create(env, req(HOST_COOKIE), {
      title: 'Quick', items: [], split_mode: 'even', total_amount: 84.5,
    });
    assert.equal((await body(res)).session.total_amount, 84.5);
  });
});

test('an unrecognised split mode falls back to itemized', async () => {
  await withStub({ users: { [HOST_COOKIE]: HOST } }, async ({ env }) => {
    const res = await create(env, req(HOST_COOKIE), { title: 'D', items: [], split_mode: 'sideways' });
    assert.equal((await body(res)).session.split_mode, 'itemized');
  });
});

test('a client cannot attribute its split to a restaurant it invented', async () => {
  await withStub({
    entities: { Restaurant: [{ id: 'r1', slug: 'joes' }] },
    users: { [HOST_COOKIE]: HOST },
  }, async ({ env }) => {
    const res = await create(env, req(HOST_COOKIE), {
      title: 'D', items: [], restaurant_id: 'r1', // straight from the body
    });
    // The host owns no restaurant, so nothing is attributed.
    assert.equal((await body(res)).session.restaurant_id, undefined);
  });
});

test('an unknown slug attributes the split to nobody rather than erroring', async () => {
  await withStub({ entities: { Restaurant: [] } }, async ({ env }) => {
    const res = await create(env, req(), { title: 'D', items: [], restaurant_slug: 'ghost' });
    assert.equal(res.status, 200);
    assert.equal((await body(res)).session.restaurant_id, undefined);
  });
});

test("a signed-in owner's split is attributed to the restaurant they own", async () => {
  await withStub({
    entities: { Restaurant: [{ id: 'r7', owner_id: 'user_1' }] },
    users: { [HOST_COOKIE]: HOST },
  }, async ({ env }) => {
    const res = await create(env, req(HOST_COOKIE), { title: 'D', items: [] });
    assert.equal((await body(res)).session.restaurant_id, 'r7');
  });
});

test('a flood of guest splits at one restaurant is throttled', async () => {
  const recent = Array.from({ length: 100 }, (_, i) => ({
    id: `s${i}`, restaurant_id: 'r1', created_date: new Date().toISOString(),
  }));
  await withStub({
    entities: { Restaurant: [{ id: 'r1', slug: 'joes' }], Session: recent },
  }, async ({ env }) => {
    const res = await create(env, req(), { title: 'D', items: [], restaurant_slug: 'joes' });
    assert.equal(res.status, 429);
  });
});

test('old splits do not count towards that throttle', async () => {
  const old = Array.from({ length: 100 }, (_, i) => ({
    id: `s${i}`, restaurant_id: 'r1',
    created_date: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  }));
  await withStub({
    entities: { Restaurant: [{ id: 'r1', slug: 'joes' }], Session: old },
  }, async ({ env }) => {
    const res = await create(env, req(), { title: 'D', items: [], restaurant_slug: 'joes' });
    assert.equal(res.status, 200);
  });
});

test('a new split starts empty, waiting, and expires in thirty days', async () => {
  await withStub({ users: { [HOST_COOKIE]: HOST } }, async ({ env }) => {
    const { session } = await body(await create(env, req(HOST_COOKIE), { title: 'D', items: [] }));
    assert.equal(session.status, 'waiting');
    assert.deepEqual(session.participants, []);
    const days = (session.expires_at - Date.now()) / 86400000;
    assert.ok(days > 29.9 && days <= 30, `expiry was ${days} days out`);
  });
});

test('stored money is rounded to cents', async () => {
  await withStub({ users: { [HOST_COOKIE]: HOST } }, async ({ env }) => {
    const { session } = await body(await create(env, req(HOST_COOKIE), {
      title: 'D', items: [{ name: 'A', price: 0.1 }, { name: 'B', price: 0.2 }], tax: 0, tip: 0,
    }));
    assert.equal(session.total_amount, 0.3);
  });
});

// ── joinSession ─────────────────────────────────────────────────────────────

/**
 * Keys handed out by joinSession, remembered per diner.
 *
 * The browser does this in src/api/functions.js: joinSession returns a
 * participant_key once and every later call that acts as that diner sends it
 * back. Mirrored here so these tests drive the same sequence a real client
 * does — without it, the second call for any diner is a 403, which is the new
 * behaviour working rather than a broken test.
 *
 * Keyed by participant id alone because each test builds its own store.
 */
const participantKeys = new Map();

const withKey = (b) => {
  const held = participantKeys.get(b?.participant_id);
  return held && b.participant_key === undefined ? { ...b, participant_key: held } : b;
};

const remember = async (b, res) => {
  // Peek without consuming: the caller still reads this Response.
  const copy = res.clone ? res.clone() : res;
  try {
    const data = await copy.json();
    if (data?.participant_key) participantKeys.set(b.participant_id, data.participant_key);
  } catch {
    /* not a JSON body, or an error response — nothing to remember */
  }
  return res;
};

const join = async (env, b) => remember(b, await HANDLERS.joinSession({ env, body: withKey(b) }));

test('joinSession needs a session id', async () => {
  assert.equal((await join({}, { participant_id: ALICE })).status, 400);
});

test('a participant id that is not the minted shape is refused', async () => {
  for (const bad of ['', 'alice', '../admin', 'p_abc_def', 'P_1_a', 'p_1_A']) {
    const res = await join({}, { session_id: 's1', participant_id: bad });
    assert.equal(res.status, 400, `"${bad}" should be refused`);
  }
});

test('joining a session that does not exist is a 404', async () => {
  await withStub({ entities: { Session: [] } }, async ({ env }) => {
    assert.equal((await join(env, { session_id: 'gone', participant_id: ALICE })).status, 404);
  });
});

test('joining an expired session is a 410, not a silent success', async () => {
  await withStub({
    entities: { Session: [{ ...simpleSession(), expires_at: Date.now() - 1000 }] },
  }, async ({ env }) => {
    const res = await join(env, { session_id: 's1', participant_id: ALICE });
    assert.equal(res.status, 410);
  });
});

test('the fifty-first diner is turned away', async () => {
  const participants = Array.from({ length: 50 }, (_, i) => ({
    participant_id: `p_170000000000${i}_x${i}`, name: `P${i}`, amount_owed: 0, payment_status: 'unpaid',
  }));
  await withStub({ entities: { Session: [{ ...simpleSession(), participants }] } }, async ({ env }) => {
    const res = await join(env, { session_id: 's1', participant_id: ALICE, items: [] });
    assert.equal(res.status, 400);
    assert.match((await body(res)).error, /full/);
  });
});

test('an existing diner rejoining does not appear twice', async () => {
  await withStub({ entities: { Session: [simpleSession()] } }, async ({ env, store }) => {
    await join(env, { session_id: 's1', participant_id: ALICE, name: 'Alice', items: [] });
    await join(env, { session_id: 's1', participant_id: ALICE, name: 'Alice', items: [] });
    assert.equal(store.Session[0].participants.length, 1);
  });
});

test('a name is trimmed and capped, and a blank one becomes Anonymous', async () => {
  await withStub({ entities: { Session: [simpleSession()] } }, async ({ env, store }) => {
    await join(env, { session_id: 's1', participant_id: ALICE, name: `  ${'n'.repeat(80)} `, items: [] });
    await join(env, { session_id: 's1', participant_id: BOB, name: '   ', items: [] });
    const [alice, bob] = store.Session[0].participants;
    assert.equal(alice.name.length, 40);
    assert.equal(bob.name, 'Anonymous');
  });
});

test('claiming one item charges its price', async () => {
  await withStub({ entities: { Session: [simpleSession()] } }, async ({ env }) => {
    const res = await join(env, {
      session_id: 's1', participant_id: ALICE, name: 'Alice',
      items: [{ id: 'i1', claimed_by: [ALICE] }],
    });
    const { session } = await body(res);
    assert.equal(session.participants.find((p) => p.participant_id === ALICE).amount_owed, 20);
  });
});

test('un-claiming releases the item and drops the amount to zero', async () => {
  await withStub({ entities: { Session: [simpleSession()] } }, async ({ env, store }) => {
    await join(env, { session_id: 's1', participant_id: ALICE, items: [{ id: 'i1', claimed_by: [ALICE] }] });
    await join(env, { session_id: 's1', participant_id: ALICE, items: [{ id: 'i1', claimed_by: [] }] });
    const stored = store.Session[0];
    assert.deepEqual(stored.items[0].claimed_by, []);
    assert.equal(stored.participants[0].amount_owed, 0);
  });
});

test('re-confirming an item you already hold is not treated as stealing it', async () => {
  await withStub({ entities: { Session: [simpleSession()] } }, async ({ env }) => {
    await join(env, { session_id: 's1', participant_id: ALICE, items: [{ id: 'i1', claimed_by: [ALICE] }] });
    const again = await join(env, {
      session_id: 's1', participant_id: ALICE, items: [{ id: 'i1', claimed_by: [ALICE] }],
    });
    assert.equal(again.status, 200);
  });
});

test('an item has exactly one payer, so nobody is charged for it twice', async () => {
  // The server refuses a second claimant and src/pages/Claim.jsx greys the row
  // out, so the two agree. shareFor() still divides by claimed_by.length; that
  // is defensive arithmetic for a shared-item feature that does not exist yet,
  // and this test is what will fail loudly if the guard is ever relaxed without
  // the UI following.
  const session = {
    ...simpleSession(),
    items: [{ id: 'i1', name: 'Nachos', price: 30, quantity: 1, claimed_by: [] }],
    total_amount: 30,
  };
  await withStub({ entities: { Session: [session] } }, async ({ env, store }) => {
    await join(env, { session_id: 's1', participant_id: ALICE, name: 'Alice', items: [{ id: 'i1', claimed_by: [ALICE] }] });

    // Through onRequestPost rather than the handler directly, because the
    // refusal is raised as an AppError from inside patchSession's mutate
    // callback and it is the dispatcher that renders it. What a diner's phone
    // receives is what this asserts, and that is unchanged: a 409 saying the
    // item is taken.
    const res = await onRequestPost({
      request: new Request('https://billtap.app/api/fn/joinSession', {
        method: 'POST',
        body: JSON.stringify({
          session_id: 's1', participant_id: BOB, name: 'Bob',
          items: [{ id: 'i1', claimed_by: [BOB] }],
        }),
      }),
      env,
      name: 'joinSession',
    });

    assert.equal(res.status, 409);
    const payload = await res.json();
    assert.match(payload.error, /already claimed/);
    assert.equal(payload.code, 'item_claimed');
    assert.ok(payload.request_id, 'traceable, like every other failure here');

    assert.deepEqual(store.Session[0].items[0].claimed_by, [ALICE]);
    assert.equal(store.Session[0].participants[0].amount_owed, 30, 'Alice owes all of it');
  });
});

test('tax and tip are shared in proportion to what each person ordered', async () => {
  // $20 steak + $10 salad, $3 tax, $6 tip. Alice has 2/3 of the food.
  const session = { ...simpleSession(), tax: 3, tip: 6, total_amount: 39 };
  await withStub({ entities: { Session: [session] } }, async ({ env, store }) => {
    await join(env, { session_id: 's1', participant_id: ALICE, name: 'A', items: [{ id: 'i1', claimed_by: [ALICE] }] });
    await join(env, { session_id: 's1', participant_id: BOB, name: 'B', items: [{ id: 'i2', claimed_by: [BOB] }] });
    const [alice, bob] = store.Session[0].participants;
    assert.equal(alice.amount_owed, 26, '20 + 2/3 of 9');
    assert.equal(bob.amount_owed, 13, '10 + 1/3 of 9');
    assert.equal(alice.amount_owed + bob.amount_owed, 39, 'the table pays the bill exactly once');
  });
});

test('someone who claims nothing owes nothing, tax included', async () => {
  const session = { ...simpleSession(), tax: 3, tip: 6, total_amount: 39 };
  await withStub({ entities: { Session: [session] } }, async ({ env, store }) => {
    await join(env, { session_id: 's1', participant_id: ALICE, name: 'A', items: [] });
    assert.equal(store.Session[0].participants[0].amount_owed, 0);
  });
});

test('an even split divides the total and rebalances as people arrive', async () => {
  const session = { ...simpleSession(), split_mode: 'even', total_amount: 90 };
  await withStub({ entities: { Session: [session] } }, async ({ env, store }) => {
    await join(env, { session_id: 's1', participant_id: ALICE, name: 'A' });
    assert.equal(store.Session[0].participants[0].amount_owed, 90);

    await join(env, { session_id: 's1', participant_id: BOB, name: 'B' });
    assert.deepEqual(store.Session[0].participants.map((p) => p.amount_owed), [45, 45]);

    await join(env, { session_id: 's1', participant_id: CARA, name: 'C' });
    assert.deepEqual(store.Session[0].participants.map((p) => p.amount_owed), [30, 30, 30]);
  });
});

test('an even split of an awkward total rounds to real cents', async () => {
  const session = { ...simpleSession(), split_mode: 'even', total_amount: 100 };
  await withStub({ entities: { Session: [session] } }, async ({ env, store }) => {
    await join(env, { session_id: 's1', participant_id: ALICE, name: 'A' });
    await join(env, { session_id: 's1', participant_id: BOB, name: 'B' });
    await join(env, { session_id: 's1', participant_id: CARA, name: 'C' });
    for (const p of store.Session[0].participants) {
      assert.equal(p.amount_owed, 33.33);
      assert.equal(Math.round(p.amount_owed * 100), p.amount_owed * 100);
    }
  });
});

test('an even split never writes the items array', async () => {
  const session = { ...simpleSession(), split_mode: 'even', total_amount: 50 };
  await withStub({ entities: { Session: [session] } }, async ({ env, store }) => {
    await join(env, {
      session_id: 's1', participant_id: ALICE, name: 'A',
      items: [{ id: 'i1', claimed_by: [ALICE] }, { id: 'i2', claimed_by: [ALICE] }],
    });
    assert.deepEqual(store.Session[0].items[0].claimed_by, [], 'claims are meaningless in an even split');
  });
});

test('a custom split keeps the amount the host set', async () => {
  const session = {
    ...simpleSession(),
    split_mode: 'custom',
    participants: [{ participant_id: ALICE, name: 'A', amount_owed: 12.34, payment_status: 'unpaid' }],
  };
  await withStub({ entities: { Session: [session] } }, async ({ env, store }) => {
    await join(env, { session_id: 's1', participant_id: ALICE, name: 'A' });
    assert.equal(store.Session[0].participants[0].amount_owed, 12.34);
  });
});

test('the first join moves the session from waiting to claiming', async () => {
  await withStub({ entities: { Session: [simpleSession()] } }, async ({ env, store }) => {
    await join(env, { session_id: 's1', participant_id: ALICE, items: [] });
    assert.equal(store.Session[0].status, 'claiming');
  });
});

test('a late joiner does not reopen a completed session', async () => {
  await withStub({
    entities: { Session: [{ ...simpleSession(), status: 'completed' }] },
  }, async ({ env, store }) => {
    await join(env, { session_id: 's1', participant_id: ALICE, items: [] });
    assert.equal(store.Session[0].status, 'completed');
  });
});

test('an unknown item id in the request is ignored, not created', async () => {
  await withStub({ entities: { Session: [simpleSession()] } }, async ({ env, store }) => {
    await join(env, {
      session_id: 's1', participant_id: ALICE,
      items: [{ id: 'i1', claimed_by: [ALICE] }, { id: 'ghost', price: 999, claimed_by: [ALICE] }],
    });
    assert.equal(store.Session[0].items.length, 2);
    assert.equal(store.Session[0].participants[0].amount_owed, 20, 'the invented item bought nothing');
  });
});

test('a price sent by the client cannot change what an item costs', async () => {
  await withStub({ entities: { Session: [simpleSession()] } }, async ({ env, store }) => {
    await join(env, {
      session_id: 's1', participant_id: ALICE,
      items: [{ id: 'i1', price: 0.01, claimed_by: [ALICE] }],
    });
    assert.equal(store.Session[0].items[0].price, 20, 'the stored price stands');
    assert.equal(store.Session[0].participants[0].amount_owed, 20);
  });
});

test('the join response hides what the rest of the table owes', async () => {
  await withStub({ entities: { Session: [simpleSession()] } }, async ({ env }) => {
    await join(env, { session_id: 's1', participant_id: ALICE, name: 'A', items: [{ id: 'i1', claimed_by: [ALICE] }] });
    const res = await join(env, { session_id: 's1', participant_id: BOB, name: 'B', items: [{ id: 'i2', claimed_by: [BOB] }] });
    const { session } = await body(res);
    const alice = session.participants.find((p) => p.participant_id === ALICE);
    const bob = session.participants.find((p) => p.participant_id === BOB);
    assert.equal(bob.amount_owed, 10, 'the caller sees their own share');
    assert.equal(alice.amount_owed, undefined);
    assert.equal(alice.name, 'A', 'names stay visible — the table needs them');
  });
});

test('the join response never carries the internal restaurant fields', async () => {
  await withStub({ entities: { Session: [simpleSession()] } }, async ({ env }) => {
    const res = await join(env, { session_id: 's1', participant_id: ALICE, items: [] });
    const { session } = await body(res);
    assert.equal(session.created_by_id, undefined);
    assert.equal(session.image_url, undefined);
  });
});

// ── markMePaid ──────────────────────────────────────────────────────────────

const paid = (env, b) => HANDLERS.markMePaid({ env, body: withKey(b) });

test('markMePaid validates its inputs', async () => {
  assert.equal((await paid({}, { participant_id: ALICE })).status, 400);
  assert.equal((await paid({}, { session_id: 's1', participant_id: 'nope' })).status, 400);
});

test('marking paid on a missing session is a 404', async () => {
  await withStub({ entities: { Session: [] } }, async ({ env }) => {
    assert.equal((await paid(env, { session_id: 'x', participant_id: ALICE })).status, 404);
  });
});

test('someone who never joined cannot mark themselves paid', async () => {
  await withStub({ entities: { Session: [simpleSession()] } }, async ({ env }) => {
    const res = await paid(env, { session_id: 's1', participant_id: ALICE });
    assert.equal(res.status, 404);
    assert.match((await body(res)).error, /Participant not found/);
  });
});

test('paying moves the diner to pending_verification, never straight to paid', async () => {
  const session = {
    ...simpleSession(),
    participants: [{ participant_id: ALICE, name: 'A', amount_owed: 20, payment_status: 'unpaid' }],
  };
  await withStub({ entities: { Session: [session] } }, async ({ env, store }) => {
    await paid(env, { session_id: 's1', participant_id: ALICE });
    assert.equal(store.Session[0].participants[0].payment_status, 'pending_verification');
    assert.notEqual(store.Session[0].status, 'completed', 'the host has not confirmed anything yet');
  });
});

test('a diner saying "I paid" can never complete the session on their own', async () => {
  // Asserting you sent money is not the same event as the money arriving, so
  // markMePaid can only ever reach pending_verification. Completion belongs to
  // confirmPayment, which is the only place the last 'paid' can be written.
  const session = {
    ...simpleSession(),
    status: 'claiming',
    participants: [{ participant_id: ALICE, name: 'A', amount_owed: 30, payment_status: 'unpaid' }],
  };
  await withStub({ entities: { Session: [session] } }, async ({ env, store }) => {
    await paid(env, { session_id: 's1', participant_id: ALICE });
    assert.equal(store.Session[0].participants[0].payment_status, 'pending_verification');
    assert.equal(store.Session[0].status, 'claiming', 'the last diner cannot flip the split to completed');
  });
});

test('a diner cannot undo the host confirmation by tapping "I paid" again', async () => {
  // They come back to the tab an hour later and hit the button again. Without
  // this guard that walks a settled row back to pending_verification and puts a
  // finished bill back on the host's to-do list.
  const session = {
    ...simpleSession(),
    participants: [{ participant_id: ALICE, name: 'A', amount_owed: 30, payment_status: 'paid', paid_amount: 30 }],
  };
  await withStub({ entities: { Session: [session] } }, async ({ env, store }) => {
    const res = await paid(env, { session_id: 's1', participant_id: ALICE });
    assert.equal(res.status, 200);
    assert.equal((await body(res)).unchanged, true);
    assert.equal(store.Session[0].participants[0].payment_status, 'paid');
  });
});

// ── submitGuestRating ───────────────────────────────────────────────────────

const rate = (env, b) => HANDLERS.submitGuestRating({ env, body: b });

const ratedSession = () => ({ id: 's1', restaurant_id: 'r1', title: 'D' });

test('an unrecognised rating action is refused', async () => {
  await withStub({}, async ({ env }) => {
    assert.equal((await rate(env, { action: 'delete' })).status, 400);
    assert.equal((await rate(env, {})).status, 400);
  });
});

test('rating requires a session id', async () => {
  await withStub({}, async ({ env }) => {
    assert.equal((await rate(env, { action: 'rate', stars: 5 })).status, 400);
  });
});

test('a star count outside one to five is refused', async () => {
  await withStub({ entities: { Session: [ratedSession()] } }, async ({ env }) => {
    for (const stars of [0, 6, -1, 3.5, 'five', null]) {
      const res = await rate(env, { action: 'rate', session_id: 's1', stars });
      assert.equal(res.status, 400, `${stars} stars should be refused`);
    }
  });
});

test('rating a session that does not exist is a 404', async () => {
  await withStub({ entities: { Session: [] } }, async ({ env }) => {
    assert.equal((await rate(env, { action: 'rate', session_id: 'x', stars: 5 })).status, 404);
  });
});

test('a split with no restaurant behind it cannot be rated', async () => {
  await withStub({ entities: { Session: [{ id: 's1' }] } }, async ({ env }) => {
    const res = await rate(env, { action: 'rate', session_id: 's1', stars: 5 });
    assert.equal(res.status, 400);
  });
});

test('the restaurant is read off the stored session, not the request', async () => {
  await withStub({
    entities: { Session: [ratedSession()], Restaurant: [{ id: 'r1', rating_threshold: 3 }] },
  }, async ({ env, store }) => {
    await rate(env, { action: 'rate', session_id: 's1', stars: 5, restaurant_id: 'r_someone_else' });
    assert.equal(store.GuestRating[0].restaurant_id, 'r1');
  });
});

test('a happy guest is routed to Google and an unhappy one is not', async () => {
  await withStub({
    entities: { Session: [ratedSession()], Restaurant: [{ id: 'r1', rating_threshold: 3 }] },
  }, async ({ env, store }) => {
    await rate(env, { action: 'rate', session_id: 's1', stars: 5 });
    assert.equal(store.GuestRating[0].routed_to_google, true);
  });
  await withStub({
    entities: { Session: [ratedSession()], Restaurant: [{ id: 'r1', rating_threshold: 3 }] },
  }, async ({ env, store }) => {
    await rate(env, { action: 'rate', session_id: 's1', stars: 2 });
    assert.equal(store.GuestRating[0].routed_to_google, false);
  });
});

test("a rating exactly on the threshold is not routed out — it is not a rave", async () => {
  await withStub({
    entities: { Session: [ratedSession()], Restaurant: [{ id: 'r1', rating_threshold: 4 }] },
  }, async ({ env, store }) => {
    await rate(env, { action: 'rate', session_id: 's1', stars: 4 });
    assert.equal(store.GuestRating[0].routed_to_google, false);
  });
});

test('a restaurant with no threshold set gets the default of three', async () => {
  await withStub({
    entities: { Session: [ratedSession()], Restaurant: [{ id: 'r1' }] },
  }, async ({ env, store }) => {
    await rate(env, { action: 'rate', session_id: 's1', stars: 4 });
    assert.equal(store.GuestRating[0].routed_to_google, true);
  });
});

test('rating twice returns the first rating instead of minting rows', async () => {
  await withStub({
    entities: { Session: [ratedSession()], Restaurant: [{ id: 'r1' }] },
  }, async ({ env, store }) => {
    const first = await body(await rate(env, { action: 'rate', session_id: 's1', stars: 5 }));
    const second = await body(await rate(env, { action: 'rate', session_id: 's1', stars: 1 }));
    assert.equal(store.GuestRating.length, 1);
    assert.equal(second.rating_id, first.rating_id);
    assert.equal(second.existing, true);
    assert.equal(store.GuestRating[0].stars, 5, 'the second attempt cannot overwrite the first');
  });
});

test('leaving contact details requires a rating to attach them to', async () => {
  await withStub({ entities: { GuestRating: [] } }, async ({ env }) => {
    assert.equal((await rate(env, { action: 'contact' })).status, 400);
    assert.equal((await rate(env, { action: 'contact', rating_id: 'nope' })).status, 404);
  });
});

test('a valid email is stored and starts a contact record', async () => {
  await withStub({
    entities: { GuestRating: [{ id: 'g1', restaurant_id: 'r1' }] },
  }, async ({ env, store }) => {
    await rate(env, { action: 'contact', rating_id: 'g1', email: '  Diner@Example.COM ', comment: 'Lovely' });
    assert.equal(store.GuestRating[0].guest_email, 'diner@example.com', 'normalised to lowercase');
    assert.equal(store.GuestRating[0].comment, 'Lovely');
    assert.equal(store.GuestContact[0].email, 'diner@example.com');
    assert.equal(store.GuestContact[0].visits, 1);
    assert.equal(store.GuestContact[0].opted_in, true);
  });
});

test('a malformed email is dropped but the comment is still kept', async () => {
  await withStub({
    entities: { GuestRating: [{ id: 'g1', restaurant_id: 'r1' }] },
  }, async ({ env, store }) => {
    await rate(env, { action: 'contact', rating_id: 'g1', email: 'not-an-email', comment: 'Still useful' });
    assert.equal(store.GuestRating[0].guest_email, undefined);
    assert.equal(store.GuestRating[0].comment, 'Still useful');
    assert.equal(store.GuestContact, undefined, 'no contact row for an unusable address');
  });
});

test('a returning guest increments their visit count instead of duplicating', async () => {
  await withStub({
    entities: {
      GuestRating: [{ id: 'g1', restaurant_id: 'r1' }],
      GuestContact: [{ id: 'c1', restaurant_id: 'r1', email: 'diner@example.com', visits: 2 }],
    },
  }, async ({ env, store }) => {
    await rate(env, { action: 'contact', rating_id: 'g1', email: 'diner@example.com' });
    assert.equal(store.GuestContact.length, 1);
    assert.equal(store.GuestContact[0].visits, 3);
    assert.ok(store.GuestContact[0].last_seen);
  });
});

test('a very long comment is truncated rather than rejected', async () => {
  await withStub({
    entities: { GuestRating: [{ id: 'g1', restaurant_id: 'r1' }] },
  }, async ({ env, store }) => {
    await rate(env, { action: 'contact', rating_id: 'g1', comment: 'x'.repeat(5000) });
    assert.equal(store.GuestRating[0].comment.length, 1500);
  });
});

// ── getPublicRestaurant ─────────────────────────────────────────────────────

test('the public restaurant lookup needs something to look up', async () => {
  const res = await HANDLERS.getPublicRestaurant({ env: {}, body: {} });
  assert.equal(res.status, 400);
});

test('an unknown restaurant is a 404', async () => {
  await withStub({ entities: { Restaurant: [] } }, async ({ env }) => {
    const res = await HANDLERS.getPublicRestaurant({ env, body: { slug: 'ghost' } });
    assert.equal(res.status, 404);
  });
});

test('the public lookup returns five fields and withholds the rest', async () => {
  const full = {
    id: 'r1', name: "Joe's", slug: 'joes',
    google_review_url: 'https://g.page/joes', rating_threshold: 4,
    alert_email: 'owner@joes.com', alert_phone: '+15551234567',
    owner_id: 'user_1', stripe_customer_id: 'cus_123', stripe_subscription_id: 'sub_123',
  };
  await withStub({ entities: { Restaurant: [full] } }, async ({ env }) => {
    const { restaurant } = await body(await HANDLERS.getPublicRestaurant({ env, body: { slug: 'joes' } }));
    assert.deepEqual(Object.keys(restaurant).sort(),
      ['google_review_url', 'id', 'name', 'rating_threshold', 'slug']);
    for (const secret of ['alert_email', 'alert_phone', 'owner_id', 'stripe_customer_id', 'stripe_subscription_id']) {
      assert.equal(restaurant[secret], undefined, `${secret} must not be public`);
    }
  });
});

test('the public lookup also works by id', async () => {
  await withStub({
    entities: { Restaurant: [{ id: 'r1', name: 'Joe', slug: 'joes' }] },
  }, async ({ env }) => {
    const { restaurant } = await body(await HANDLERS.getPublicRestaurant({ env, body: { id: 'r1' } }));
    assert.equal(restaurant.slug, 'joes');
  });
});

// ── getRestaurantDashboardData ──────────────────────────────────────────────

test('the operator dashboard is closed to anonymous callers', async () => {
  await withStub({}, async ({ env }) => {
    const res = await HANDLERS.getRestaurantDashboardData({ env, request: req() });
    assert.equal(res.status, 401);
  });
});

test('a signed-in user who owns no restaurant sees an empty dashboard', async () => {
  await withStub({
    entities: { Restaurant: [] },
    users: { [HOST_COOKIE]: HOST },
  }, async ({ env }) => {
    const out = await body(await HANDLERS.getRestaurantDashboardData({ env, request: req(HOST_COOKIE) }));
    assert.equal(out.restaurant, null);
    assert.deepEqual(out.ratings, []);
  });
});

test('an operator sees their own ratings and contacts, and only theirs', async () => {
  await withStub({
    entities: {
      Restaurant: [{ id: 'r1', owner_id: 'user_1' }, { id: 'r2', owner_id: 'user_2' }],
      GuestRating: [{ id: 'g1', restaurant_id: 'r1', stars: 5 }, { id: 'g2', restaurant_id: 'r2', stars: 1 }],
      GuestContact: [{ id: 'c1', restaurant_id: 'r1' }, { id: 'c2', restaurant_id: 'r2' }],
    },
    users: { [HOST_COOKIE]: HOST },
  }, async ({ env }) => {
    const out = await body(await HANDLERS.getRestaurantDashboardData({ env, request: req(HOST_COOKIE) }));
    assert.equal(out.restaurant_id, 'r1');
    assert.deepEqual(out.ratings.map((r) => r.id), ['g1']);
    assert.deepEqual(out.contacts.map((c) => c.id), ['c1']);
  });
});

// ── The access layer ────────────────────────────────────────────────────────

test('the app id strips the app_ prefix that returned "App not found"', () => {
  assert.equal(appId({ BASE44_APP_ID: 'app_69a5abc' }), '69a5abc');
  assert.equal(appId({ BASE44_APP_ID: '  69a5abc  ' }), '69a5abc');
});

test('the app id falls back to the VITE_ name, and is null when unset', () => {
  assert.equal(appId({ VITE_BASE44_APP_ID: 'abc' }), 'abc');
  assert.equal(appId({}), null);
  assert.equal(appId({ BASE44_APP_ID: '' }), null);
});

test('a prefixed and an unprefixed secret cannot disagree', () => {
  assert.equal(appId({ BASE44_APP_ID: 'app_x1' }), appId({ VITE_BASE44_APP_ID: 'x1' }));
});

test('the Base44 origin defaults to the host that actually answers', () => {
  assert.equal(base44Origin({}), 'https://base44.app');
  assert.notEqual(base44Origin({}), 'https://api.base44.com/v0');
});

test('the origin can be overridden, with trailing slashes trimmed', () => {
  assert.equal(base44Origin({ BASE44_API_ORIGIN: 'https://staging.base44.app///' }), 'https://staging.base44.app');
  assert.equal(base44Origin({ BASE44_API_BASE: 'https://alt.base44.app' }), 'https://alt.base44.app');
});

test('serviceRole refuses to exist without a master key', () => {
  assert.throws(() => serviceRole({ BASE44_APP_ID: 'x' }), /BASE44_MASTER_KEY/);
});

test('serviceRole signs its calls with the master key', async () => {
  await withStub({ entities: { Session: [simpleSession()] } }, async ({ env, calls }) => {
    await serviceRole(env).entity('Session').filter({ id: 's1' });
    assert.equal(calls.at(-1).auth, `Bearer ${MASTER}`);
  });
});

test('asCaller forwards the caller credentials and nothing else', () => {
  const r = new Request('https://billtap.app/', {
    headers: { cookie: 'base44_session=abc', authorization: 'Bearer caller-token' },
  });
  const { headers } = asCaller({}, r);
  assert.equal(headers.Cookie, 'base44_session=abc');
  assert.equal(headers.Authorization, 'Bearer caller-token');
  assert.ok(!Object.values(headers).includes(`Bearer ${MASTER}`));
});

test('asCaller on an anonymous request forwards no credentials at all', () => {
  const { headers } = asCaller({}, new Request('https://billtap.app/'));
  assert.deepEqual(headers, {});
});

test('currentUser does not call Base44 at all when there is nothing to send', async () => {
  await withStub({}, async ({ env, calls }) => {
    assert.equal(await currentUser(env, req()), null);
    assert.equal(calls.length, 0, 'a guest costs zero round trips');
  });
});

test('currentUser returns null for a rejected credential rather than throwing', async () => {
  await withStub({ users: {} }, async ({ env }) => {
    assert.equal(await currentUser(env, req('base44_session=stale')), null);
  });
});

test('currentUser resolves a good credential to the user', async () => {
  await withStub({ users: { [HOST_COOKIE]: HOST } }, async ({ env }) => {
    const user = await currentUser(env, req(HOST_COOKIE));
    assert.equal(user.id, 'user_1');
  });
});

test('an id lookup that misses returns an empty list, not an exception', async () => {
  await withStub({ entities: { Session: [] } }, async ({ env }) => {
    assert.deepEqual(await serviceRole(env).entity('Session').filter({ id: 'nope' }), []);
  });
});

test('list can page past the first two hundred rows', async () => {
  const rows = Array.from({ length: 250 }, (_, i) => ({ id: `s${i}` }));
  await withStub({ entities: { Session: rows } }, async ({ env }) => {
    const svc = serviceRole(env);
    const first = await svc.entity('Session').list('-created_date', 200, 0);
    const second = await svc.entity('Session').list('-created_date', 200, 200);
    assert.equal(first.length, 200);
    assert.equal(second.length, 50);
    assert.notEqual(first[0].id, second[0].id, 'the second page is not the first page again');
  });
});

// ── Keeping the table in sync ───────────────────────────────────────────────

test('a diner can read the split without being able to read the row', async () => {
  const session = {
    ...simpleSession(),
    host_key_hash: 'a'.repeat(64),
    host_payment_info: { method: 'venmo', handle: '@kai' },
    participants: [
      { participant_id: ALICE, name: 'Alice', amount_owed: 20, payment_status: 'paid', paid_amount: 20 },
      { participant_id: BOB, name: 'Bob', amount_owed: 10, payment_status: 'unpaid' },
    ],
  };
  await withStub({ entities: { Session: [session] } }, async ({ env }) => {
    const res = await HANDLERS.getSplitStatus({ env, body: { session_id: 's1', participant_id: BOB } });
    assert.equal(res.status, 200);
    const { session: scoped } = await body(res);

    const alice = scoped.participants.find((p) => p.participant_id === ALICE);
    const bob = scoped.participants.find((p) => p.participant_id === BOB);
    assert.equal(alice.payment_status, 'paid', 'the table can see who has settled');
    assert.equal(alice.name, 'Alice');
    assert.equal(alice.amount_owed, undefined, "but not what anyone else owes");
    assert.equal(bob.amount_owed, 10, 'their own share is theirs to see');
    assert.equal(scoped.host_payment_info.handle, '@kai', 'they need somewhere to send the money');
  });
});

test('polling never hands out the key that controls the split', async () => {
  const session = { ...simpleSession(), host_key_hash: 'b'.repeat(64) };
  await withStub({ entities: { Session: [session] } }, async ({ env }) => {
    const res = await HANDLERS.getSplitStatus({ env, body: { session_id: 's1', participant_id: ALICE } });
    const out = await body(res);
    assert.equal(out.session.host_key_hash, undefined);
    assert.ok(!JSON.stringify(out).includes('b'.repeat(64)));
  });
});

test('someone who has not joined yet can still watch the split', async () => {
  // The claim screen polls before the name gate is answered.
  await withStub({ entities: { Session: [simpleSession()] } }, async ({ env }) => {
    const res = await HANDLERS.getSplitStatus({ env, body: { session_id: 's1' } });
    assert.equal(res.status, 200);
    const { session: scoped } = await body(res);
    assert.equal(scoped.id, 's1');
    for (const p of scoped.participants) assert.equal(p.amount_owed, undefined);
  });
});

test('getSplitStatus validates its inputs', async () => {
  await withStub({ entities: { Session: [] } }, async ({ env }) => {
    assert.equal((await HANDLERS.getSplitStatus({ env, body: {} })).status, 400);
    assert.equal((await HANDLERS.getSplitStatus({ env, body: { session_id: 's1', participant_id: '../x' } })).status, 400);
    assert.equal((await HANDLERS.getSplitStatus({ env, body: { session_id: 'gone' } })).status, 404);
  });
});

// ── Rate limiting a restaurant's shared wifi ────────────────────────────────

test('a whole table on one wifi does not share a rate-limit bucket', async () => {
  // Six diners behind a restaurant's NAT are one CF-Connecting-IP. Keying the
  // table endpoints on that address means the busiest, most legitimate use of
  // the product is the first thing throttled.
  const at = (path, participant) => limitKey(
    new Request('https://billtap.app' + path, {
      headers: {
        'CF-Connecting-IP': '203.0.113.7',
        ...(participant ? { 'X-BillTap-Participant': participant } : {}),
      },
    }),
    path,
  );

  const alice = at('/api/fn/joinSession', ALICE);
  const bob = at('/api/fn/joinSession', BOB);
  assert.notEqual(alice, bob, 'two diners at one table are counted separately');
  assert.equal(at('/api/fn/getSplitStatus', ALICE), alice, 'one bucket per person, not per endpoint');
});

test('the endpoints that spend money stay keyed to the address', async () => {
  const spendy = (path) => limitKey(
    new Request('https://billtap.app' + path, {
      headers: { 'CF-Connecting-IP': '203.0.113.7', 'X-BillTap-Participant': ALICE },
    }),
    path,
  );
  // rating-alert sends an SMS per call, restaurant-lead sends email, and
  // createSession writes rows. A fresh participant id must not buy a fresh
  // allowance for any of them.
  for (const path of ['/api/rating-alert', '/api/restaurant-lead', '/api/fn/createSession']) {
    assert.equal(spendy(path), '203.0.113.7', `${path} must stay on the address`);
  }
});

test('a malformed participant header falls back to the address', async () => {
  const key = limitKey(
    new Request('https://billtap.app/api/fn/joinSession', {
      headers: { 'CF-Connecting-IP': '203.0.113.7', 'X-BillTap-Participant': '../../etc/passwd' },
    }),
    '/api/fn/joinSession',
  );
  assert.equal(key, '203.0.113.7', 'an arbitrary key would let one caller spray buckets');
});

test('every table endpoint is actually rate limited', async () => {
  for (const path of PER_PARTICIPANT) {
    assert.ok(LIMITED.has(path), `${path} is keyed per participant but never checked`);
  }
});

// ── Account recovery ────────────────────────────────────────────────────────

test('the reset link in the email is a route the edge will serve', async () => {
  // Base44 composes that link and it lands as a deep link, so the Worker sees
  // it before React exists. A path missing from SPA_ROUTES gets the shell with
  // a 404 status — the app boots, and the first thing someone recovering an
  // account reads is a page reporting itself as not found.
  const worker = (await import('./index.js')).default;
  const assets = {
    fetch: async () => new Response('<html>shell</html>', {
      status: 200, headers: { 'content-type': 'text/html' },
    }),
  };

  for (const path of ['/forgot-password', '/reset-password']) {
    const res = await worker.fetch(new Request(`https://billtap.app${path}`), { ...WORKER_ENV, ASSETS: assets });
    assert.equal(res.status, 200, `${path} must not 404 at the edge`);
  }
  const withToken = await worker.fetch(
    new Request('https://billtap.app/reset-password?token=abc123'), { ...WORKER_ENV, ASSETS: assets },
  );
  assert.equal(withToken.status, 200, 'the token in the query must not change the answer');
});

test('the endpoint that sends reset emails is rate limited', async () => {
  // It emails whatever address it is handed, from this app's domain. Unmetered,
  // it is a way to bomb an inbox and burn the sending reputation with it.
  const path = '/api/apps/69a5abc/auth/reset-password-request';
  assert.equal(isLimited(path), true);
  assert.equal(limitKey(new Request('https://billtap.app' + path, {
    headers: { 'CF-Connecting-IP': '203.0.113.7', 'X-BillTap-Participant': ALICE },
  }), path), '203.0.113.7', 'and keyed to the address, not to a header anyone can rotate');
});

test('the password endpoints are rate limited too', async () => {
  for (const suffix of ['login', 'register', 'reset-password', 'resend-otp']) {
    assert.equal(isLimited(`/api/apps/69a5abc/auth/${suffix}`), true, suffix);
  }
});

test('rate limiting runs before anything can route past it', async () => {
  // The check used to sit below the Base44 proxy branch, which returned for
  // every /api/apps/** path, so none of the auth endpoints were ever checked.
  // The proxy is gone; the ordering it exposed is the thing worth keeping.
  const worker = (await import('./index.js')).default;
  let proxied = false;
  const env = {
    ...WORKER_ENV,
    ASSETS: { fetch: async () => new Response('', { status: 200 }) },
    API_RATE_LIMITER: { limit: async () => ({ success: false }) },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { proxied = true; return new Response('{}', { status: 200 }); };
  try {
    const res = await worker.fetch(
      new Request('https://billtap.app/api/apps/69a5abc/auth/reset-password-request', { method: 'POST', body: '{}' }),
      env,
    );
    assert.equal(res.status, 429);
    assert.equal(proxied, false, 'a throttled request must never reach Base44');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('an entity read is answered by this Worker rather than forwarded anywhere', async () => {
  // /api/apps/** used to be proxied to Base44 — that is the shape the SDK
  // issued every entity, auth and function call in, and the browser has no SDK
  // now. The path must 404 as JSON like any other unmatched /api/ route, and it
  // must not reach the network on its way there: a proxy left in place after
  // the client stopped using it is an open forwarder pointed at a vendor whose
  // credentials this app still holds.
  const worker = (await import('./index.js')).default;
  let reached = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { reached = String(url); return new Response('[]', { status: 200 }); };
  try {
    const res = await worker.fetch(
      new Request('https://billtap.app/api/apps/69a5abc/entities/Session'),
      { ...WORKER_ENV, ASSETS: { fetch: async () => new Response('', { status: 404 }) } },
    );
    assert.equal(res.status, 404);
    assert.equal(res.headers.get('content-type'), 'application/json');
    assert.equal(reached, null, 'nothing may be forwarded to Base44');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── The security page and its contact file ──────────────────────────────────

test('the security page is a real route, not a soft 404', async () => {
  const worker = (await import('./index.js')).default;
  const assets = { fetch: async () => new Response('<html>shell</html>', { status: 200, headers: { 'content-type': 'text/html' } }) };
  const res = await worker.fetch(new Request('https://billtap.app/security'), { ...WORKER_ENV, ASSETS: assets });
  assert.equal(res.status, 200);
});

test('the security page is prerendered, so a crawler sees the claims', async () => {
  // The page exists to be read by people evaluating a vendor, and increasingly
  // by their automated questionnaires. An empty <div id="root"> is worth nothing
  // to either.
  const { PRERENDERED } = await import('./index.js');
  assert.equal(PRERENDERED['/security'], '/security.html');
});

test('security.txt is reachable at the path RFC 9116 specifies', async () => {
  // A researcher, a scanner or a vendor questionnaire looks here and nowhere
  // else. Served from public/, so the assets binding answers it directly.
  const { readFile } = await import('node:fs/promises');
  const txt = await readFile(new URL('../public/.well-known/security.txt', import.meta.url), 'utf8');
  assert.match(txt, /^Contact: mailto:security@billtap\.app$/m);
  assert.match(txt, /^Policy: https:\/\/billtap\.app\/security$/m);
  assert.match(txt, /^Canonical: https:\/\/billtap\.app\/\.well-known\/security\.txt$/m);
});

test('the security.txt expiry has not passed', async () => {
  // RFC 9116 requires Expires, and a stale file is treated as no file — the
  // failure mode is silent, so it needs a test rather than a diary entry.
  const { readFile } = await import('node:fs/promises');
  const txt = await readFile(new URL('../public/.well-known/security.txt', import.meta.url), 'utf8');
  const expires = txt.match(/^Expires: (.+)$/m)?.[1];
  assert.ok(expires, 'Expires is required');
  assert.ok(new Date(expires) > new Date(), `security.txt expired on ${expires}`);
});

test('the security page claims nothing the gaps section contradicts', async () => {
  // The guard against this page drifting into marketing. Every phrase below is
  // something we do not have; if one appears as a claim, either it became true
  // and this test should be updated deliberately, or somebody wrote it because
  // it sounded good.
  const { readFile } = await import('node:fs/promises');
  const page = await readFile(new URL('../src/pages/Security.jsx', import.meta.url), 'utf8');

  const forbidden = [
    /\bSOC ?2 (?:certified|compliant)\b/i,
    /\bISO ?27001 (?:certified|compliant)\b/i,
    /\bPCI[- ]DSS (?:certified|compliant)\b/i,
    /\bHIPAA compliant\b/i,
    /\bmilitary[- ]grade\b/i,
    /\bunhackable\b/i,
    /\b100% secure\b/i,
    /\bbank[- ]grade security\b/i,
  ];
  for (const pattern of forbidden) {
    assert.ok(!pattern.test(page), `security page makes an unearned claim: ${pattern}`);
  }

  // And the gaps section must still be there.
  assert.match(page, /have not had a third-party penetration test/i);
  assert.match(page, /hold no security certification/i);
});
