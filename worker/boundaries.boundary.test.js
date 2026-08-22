/**
 * Every boundary, broken on purpose.
 *
 * A boundary is a place where control enters this application from outside it —
 * an HTTP request, a cron firing, a callback from a payment provider — or where
 * it leaves for a system that can fail: a database, a model, an SMS gateway.
 * The rule at each of them is the same and it is the whole subject of this
 * file: nothing escapes, and nothing technical comes back.
 *
 * Each test here injects a failure rather than asserting on source text,
 * because a try/catch that exists is not the same as a try/catch that catches
 * the thing that actually goes wrong.
 *
 * ── The one that was missing ────────────────────────────────────────────────
 *
 * `fetch` in worker/index.js had no outer catch. The environment check had one,
 * the POST table had one, invokeFunction had one — and the routing between them
 * did not, so a throw from `new URL`, from the rate limiter, or from any
 * `env.ASSETS.fetch` left the Worker and became Cloudflare's 1101 page: no
 * message, no request id, no log line, no Sentry event. The most important
 * failure in the application was the one it could say least about.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';

import worker from './index.js';
import { onRequestPost as invokeFunction } from './routes/functions.js';
import { onRequestGet as errorLog, buildQuery } from './routes/error-log.js';
import { publicShape, redactPublic, AppError, GENERIC } from './lib/errors.js';
import { summarise, buildRow, severityOf } from './lib/error-log.js';

const ENV = {
  DATA_BACKEND: 'supabase',
  ENVIRONMENT: 'production',
  SUPABASE_URL: 'https://stub.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
};

const CTX = { waitUntil() {} };

let realFetch;
beforeEach(() => { realFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = realFetch; });

/** An assets binding that behaves, unless told to explode. */
const assets = (impl) => ({ fetch: impl || (async () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } })) });

// ─────────────────────────────────────────────────────────────────────────────
// 1. Two layers: what comes back, and what does not
// ─────────────────────────────────────────────────────────────────────────────

describe('the public layer never carries technical detail', () => {
  const LEAKY = [
    ['a stack trace', 'Boom\n    at handler (/workspace/billtap/worker/routes/functions.js:412:9)'],
    ['a connection string', 'could not connect to postgresql://app:hunter2@db.internal:5432/billtap'],
    ['a Supabase host', 'fetch failed for https://skrqxxhoxbrvlviqrhjt.supabase.co/rest/v1/sessions'],
    ['a credentialled URL', 'GET https://user:s3cret@api.example.com/v1 failed'],
    ['an internal path', 'ENOENT: no such file or directory, open /var/task/dist/index.js'],
    ['a framework version', 'wrangler 4.42.1 could not resolve the binding'],
    ['a JWT', 'invalid token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghij'],
    ['a service key', 'apikey sk_live_51H8xQ2eZvKYlo2C rejected'],
    ['a hex secret', 'signature 4f2a91cc8e1d4b7a9f03e5c6d8b1a2f34f2a91cc8e1d4b7a9f03e5c6d8b1a2f3 did not match'],
    ['an IP address', 'connect ETIMEDOUT 10.4.19.221:5432'],
    ['a SQL constraint', 'duplicate key value violates unique constraint "sessions_pkey"'],
    ['a column name', 'column "host_key_hash" does not exist'],
    ['a SQL statement', 'select id, host_key_hash from sessions where id = $1'],
  ];

  test.each(LEAKY)('redacts %s', (_what, message) => {
    expect(redactPublic(message)).toBeNull();
  });

  test.each(LEAKY)('and never publishes %s through publicShape', (_what, message) => {
    // Both sides of 500, because a 400 assembled by interpolation leaks exactly
    // as well as a 502 does.
    for (const status of [400, 409, 500, 502]) {
      const { body } = publicShape(new AppError('some_code', message, status), 'ab12cd', 'fn/test');
      expect(JSON.stringify(body)).not.toContain(message);
      expect(body.request_id).toBe('ab12cd');
      expect(body.error.length).toBeLessThan(120);
    }
  });

  test('a sentence written for a stranger still gets through', () => {
    // The redactor has to be a filter, not a wall. If every message collapses
    // to the generic one, the product loses the thing 4xx messages are for.
    for (const safe of [
      'That receipt has too many line items.',
      'Only the host can confirm a payment.',
      'Item "Steak frites" is already paid for by someone who has settled',
      'Session is full (max 50 participants)',
      'Your payment is already settled for this split',
    ]) {
      expect(redactPublic(safe)).toBe(safe);
      expect(publicShape(new AppError('c', safe, 409), 'ab12cd').body.error).toBe(safe);
    }
  });

  test('a message long enough to be a dump is withheld whatever it says', () => {
    expect(redactPublic('a'.repeat(400))).toBeNull();
  });

  test('anything that is not an AppError is replaced wholesale', () => {
    // A TypeError's message was not written for a stranger, so no amount of
    // scanning makes it safe to show one.
    const { body, status } = publicShape(new TypeError("Cannot read properties of undefined (reading 'participants')"), 'ab12cd');
    expect(status).toBe(500);
    expect(body.error).toBe(GENERIC);
    expect(JSON.stringify(body)).not.toContain('participants');
  });

  test('the private layer keeps everything the public one dropped', () => {
    const error = new Error('connect ETIMEDOUT 10.4.19.221:5432');
    error.stack = 'Error: connect ETIMEDOUT\n    at db (/workspace/billtap/worker/lib/db.js:88:11)';
    const row = buildRow(error, {
      id: 'ab12cd', route: 'fn/createSession', method: 'POST',
      request: new Request('https://billtap.app/api/fn/createSession', { method: 'POST' }),
      body: { title: 'Dinner' }, env: ENV,
    });
    expect(row.stack).toContain('worker/lib/db.js:88');
    expect(row.message).toContain('10.4.19.221');
    expect(row.request_id).toBe('ab12cd');
    expect(row.severity).toBe('fatal');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Boundary coverage: each one, made to fail
// ─────────────────────────────────────────────────────────────────────────────

describe('the outermost request boundary', () => {
  test('a throw in the routing does not become a 1101', async () => {
    // The gap. ASSETS.fetch sits outside every inner catch, so this used to
    // leave the Worker entirely.
    const env = { ...ENV, ASSETS: assets(async () => { throw new Error('binding exploded'); }) };
    const res = await worker.fetch(new Request('https://billtap.app/about'), env, CTX);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe(GENERIC);
    expect(body.request_id).toMatch(/^[0-9a-f]{6}$/);
    expect(res.headers.get('X-Request-Id')).toBe(body.request_id);
    expect(JSON.stringify(body)).not.toContain('binding exploded');
  });

  test('a throw in the rate limiter does not take the request down', async () => {
    // Fails open by design — see worker/lib/rate-limit.js — so this asserts the
    // request is *served*, not that it is caught.
    // The database is stubbed as healthy so the limiter is the only thing that
    // can fail — otherwise this passes or fails on whether stub.supabase.co
    // resolves, which is a different test entirely.
    globalThis.fetch = async () => new Response(JSON.stringify([{ id: 's1', participants: [], items: [] }]));
    const env = {
      ...ENV,
      ASSETS: assets(),
      API_RATE_LIMITER: { limit: async () => { throw new Error('limiter unavailable'); } },
    };
    const res = await worker.fetch(
      new Request('https://billtap.app/api/fn/getSplitStatus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: 's1' }),
      }),
      env, CTX,
    );
    expect(res.status).not.toBe(500);
  });

  test('one request has exactly one id, wherever it broke', async () => {
    // The id a caller reads aloud must not depend on which layer failed.
    globalThis.fetch = async () => { throw new Error('database down'); };
    const res = await worker.fetch(
      new Request('https://billtap.app/api/fn/getSplitStatus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: 's1' }),
      }),
      { ...ENV, ASSETS: assets() }, CTX,
    );
    const body = await res.json();
    expect(res.headers.get('X-Request-Id')).toBe(body.request_id);
  });
});

describe('the function dispatcher', () => {
  const call = (name, body, env = ENV) => invokeFunction({
    request: new Request(`https://billtap.app/api/fn/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env, ctx: CTX, name,
  });

  test('a handler that throws is a clean 500', async () => {
    globalThis.fetch = async () => { throw new Error('postgres://app:pw@db:5432 unreachable'); };
    const res = await call('getSplitStatus', { session_id: 's1' });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('postgres://');
    expect(body.request_id).toBeTruthy();
  });

  test('malformed JSON is a 400 and not a parse crash', async () => {
    const res = await invokeFunction({
      request: new Request('https://billtap.app/api/fn/getSplitStatus', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json',
      }),
      env: ENV, ctx: CTX, name: 'getSplitStatus',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_json');
  });

  test('a JSON body that is not an object is a 400', async () => {
    // `null` is valid JSON, and every handler destructures off `body`.
    for (const raw of ['null', '[]', '"a string"', '42']) {
      const res = await invokeFunction({
        request: new Request('https://billtap.app/api/fn/getSplitStatus', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw,
        }),
        env: ENV, ctx: CTX, name: 'getSplitStatus',
      });
      expect(res.status).toBe(400);
    }
  });

  test('an unknown function is a 404, not an undefined call', async () => {
    const res = await call('noSuchFunction', {});
    expect(res.status).toBe(404);
  });

  test('an oversized body is refused before it is parsed', async () => {
    const res = await invokeFunction({
      request: new Request('https://billtap.app/api/fn/createSession', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'x'.repeat(300_000) }),
      }),
      env: ENV, ctx: CTX, name: 'createSession',
    });
    expect(res.status).toBe(413);
  });

  test('a misconfigured backend fails closed with no detail', async () => {
    const res = await call('getSplitStatus', { session_id: 's1' }, { DATA_BACKEND: 'nonsense' });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('misconfigured');
    expect(JSON.stringify(body)).not.toContain('nonsense');
  });
});

describe('scheduled work', () => {
  test('a failing retention pass does not fail the invocation', async () => {
    // Logged and reported, never rethrown: an exception out of a scheduled
    // handler marks the whole invocation failed, and the retention job is not
    // the only thing that fires on that cron.
    globalThis.fetch = async () => { throw new Error('database down'); };
    const waits = [];
    await worker.scheduled({ cron: '30 9 * * *' }, ENV, { waitUntil: (p) => waits.push(p) });
    await expect(Promise.all(waits)).resolves.toBeDefined();
  });

  test('a failing backup DOES fail the invocation', async () => {
    // The opposite rule, on purpose. A backup that reports success and stores
    // nothing is the failure the whole job exists to prevent.
    const waits = [];
    await worker.scheduled({ cron: '0 9 * * *' }, ENV, { waitUntil: (p) => waits.push(p) });
    await expect(Promise.all(waits)).rejects.toThrow(/BACKUP_BUCKET/);
  });
});

describe('third-party and callback boundaries', () => {
  const post = (path, body, env = ENV) => worker.fetch(
    new Request(`https://billtap.app${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { ...env, ASSETS: assets() }, CTX,
  );

  // Each of these leaves the Worker for something that can be down: a model,
  // an SMS gateway, a mail provider, a payment page.
  test.each([
    ['/api/scan-receipt', {}],
    ['/api/rating-alert', { rating_id: 'r1' }],
    ['/api/restaurant-lead', { email: 'a@b.co', restaurant_name: 'X' }],
    ['/api/create-checkout', { plan: 'pro' }],
    ['/api/verify-checkout', { session_id: 'cs_1' }],
    ['/api/monthly-report', {}],
  ])('%s answers rather than throwing when its dependency is down', async (path, body) => {
    globalThis.fetch = async () => { throw new Error('upstream at /var/task/node_modules/x.js:1 is down'); };
    const res = await post(path, body);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(600);
    const text = await res.text();
    expect(text).not.toContain('/var/task');
    expect(text).not.toContain('node_modules');
    // JSON, always. An HTML error page from the assets fallback is how a caller
    // gets a parse error instead of a message.
    expect(() => JSON.parse(text)).not.toThrow();
  });

  test.each([
    '/api/scan-receipt', '/api/rating-alert', '/api/create-checkout', '/api/verify-checkout',
  ])('%s refuses a GET rather than treating it as a callback', async (path) => {
    const res = await worker.fetch(
      new Request(`https://billtap.app${path}`), { ...ENV, ASSETS: assets() }, CTX,
    );
    expect(res.status).toBe(405);
  });

  test('an unmatched /api/ path is JSON, not the SPA shell', async () => {
    // Falling through to the assets binding would hand back index.html and turn
    // a typo into a parse error inside somebody's catch block.
    const res = await worker.fetch(
      new Request('https://billtap.app/api/nope'), { ...ENV, ASSETS: assets() }, CTX,
    );
    expect(res.status).toBe(404);
    expect(res.headers.get('Content-Type')).toContain('json');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. The logging pipeline
// ─────────────────────────────────────────────────────────────────────────────

describe('the error log captures what it should and nothing more', () => {
  test('every field the policy names is present', () => {
    const row = buildRow(new AppError('not_host', 'Only the host can do that.', 403), {
      id: 'ab12cd', route: 'fn/confirmPayment', method: 'POST',
      request: new Request('https://billtap.app/x', {
        method: 'POST', headers: { 'X-BillTap-Participant': 'p_1700000000000_alice1' },
      }),
      body: { session_id: 's1' }, env: ENV,
    });
    for (const field of ['request_id', 'route', 'method', 'severity', 'status', 'code', 'message', 'stack', 'session_ref', 'input', 'environment']) {
      expect(row).toHaveProperty(field);
    }
    expect(row.session_ref).toBe('p_1700000000000_alice1');
    expect(row.severity).toBe('warn');
  });

  test('severity separates the caller\'s mistake from ours', () => {
    expect(severityOf(new AppError('c', 'm', 400), 400)).toBe('warn');
    expect(severityOf(new AppError('c', 'm', 502), 502)).toBe('error');
    expect(severityOf(new TypeError('x'), 500)).toBe('fatal');
  });

  test('the request input is a shape, never the receipt', () => {
    // A body on this app is people's names, what they ordered and what they
    // owe. Copying it into a ninety-day table rebuilds exactly what the
    // retention job strips out of sessions at thirty.
    const input = summarise({
      title: 'Dinner with Priya and Sam',
      split_mode: 'even',
      host_key: 'hk_supersecret',
      participant_key: 'pk_alsosecret',
      items: [{ name: 'Steak frites', price: 34.5, claimed_by: ['p_1'] }],
      total_amount: 128.4,
    });

    const serialised = JSON.stringify(input);
    for (const secret of ['Priya', 'Sam', 'Steak frites', 'hk_supersecret', 'pk_alsosecret']) {
      expect(serialised).not.toContain(secret);
    }
    // And still says enough to diagnose with.
    expect(input.split_mode).toBe('even');
    expect(input.items.array).toBe(1);
    expect(input.title).toBe('string(25)');
    expect(input.host_key).toBe('[withheld]');
  });

  test('a missing database is a no-op, not an error inside an error', () => {
    expect(() => buildRow(new Error('x'), { id: 'a', route: 'r', env: {} })).not.toThrow();
  });
});

describe('reading the log back', () => {
  test('it is filterable by date, route and severity', () => {
    const q = buildQuery(new URLSearchParams({
      since: '2026-08-01', until: '2026-08-05T12:00:00Z', severity: 'error', route: '/api/fn/',
    }));
    const all = q.getAll('at');
    expect(all).toContain('gte.2026-08-01');
    expect(all).toContain('lte.2026-08-05T12:00:00Z');
    expect(q.get('severity')).toBe('eq.error');
    expect(q.get('route')).toBe('like./api/fn/*');
    expect(q.get('order')).toBe('at.desc');
  });

  test('a filter value cannot become a clause', () => {
    // PostgREST parameters are a query language. The orphan sweep already
    // produced one injection through exactly this door.
    for (const [key, value] of [
      ['severity', 'error,or(id.gt.0)'],
      ['route', '/api/*,or(id.gt.0)'],
      ['since', "2026-01-01') or ('1'='1"],
      ['request_id', 'ab12cd,or(id.gt.0)'],
    ]) {
      expect(() => buildQuery(new URLSearchParams({ [key]: value }))).toThrow();
    }
  });

  test('the page size is capped rather than trusted', () => {
    expect(buildQuery(new URLSearchParams({ limit: '100000' })).get('limit')).toBe('200');
    expect(buildQuery(new URLSearchParams()).get('limit')).toBe('50');
  });

  test('without a read key the endpoint does not admit it exists', async () => {
    // 404, not 401. An endpoint that says "here, but you need a key" is an
    // invitation to go and find the key.
    const res = await errorLog({ request: new Request('https://billtap.app/api/error-log'), env: ENV });
    expect(res.status).toBe(404);
  });

  test('a wrong key is refused the same way', async () => {
    const res = await errorLog({
      request: new Request('https://billtap.app/api/error-log', { headers: { Authorization: 'Bearer wrong' } }),
      env: { ...ENV, ERROR_LOG_READ_KEY: 'right-key-value' },
    });
    expect(res.status).toBe(404);
  });

  test('an upstream failure does not republish what the log holds', async () => {
    globalThis.fetch = async () => new Response('relation "error_log" does not exist', { status: 400 });
    const res = await errorLog({
      request: new Request('https://billtap.app/api/error-log', { headers: { Authorization: 'Bearer right-key-value' } }),
      env: { ...ENV, ERROR_LOG_READ_KEY: 'right-key-value' },
    });
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('relation');
  });
});
