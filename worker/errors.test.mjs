/**
 * The error layer.
 *
 * Two things are being protected here and they pull in opposite directions.
 *
 * A caller must be told enough to act — which of their inputs was wrong, and
 * whether trying again is worth it. And a caller must be told nothing about the
 * inside of the system, because the same code path that formats a friendly
 * message is the one that would cheerfully forward a Postgres error naming a
 * column, a hostname, or the email address of whoever the query was about.
 *
 * The dividing line is the status. Below 500 the message was written for a
 * stranger and is safe. At 500 and above the message came from somewhere we do
 * not control, and it is replaced wholesale.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AppError, badRequest, forbidden, upstream,
  errorResponse, publicShape, requestId, logError,
} from './lib/errors.js';

const body = (res) => res.json();

/** Captures console.error so a test can read the structured log line. */
function capturing(fn) {
  const original = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args.join(' '));
  try {
    return fn(lines);
  } finally {
    console.error = original;
  }
}

// ── Request ids ─────────────────────────────────────────────────────────────

test('a request id is six hex characters, because someone reads it aloud', () => {
  const id = requestId();
  assert.match(id, /^[0-9a-f]{6}$/);
});

test('request ids differ', () => {
  const ids = new Set(Array.from({ length: 200 }, () => requestId()));
  // Collisions are possible at this length and do not matter — the id is only
  // ever used to find recent log lines next to a timestamp, never as a key. But
  // a generator returning one value would make it useless.
  assert.ok(ids.size > 190, `expected near-unique ids, got ${ids.size} of 200`);
});

// ── What a caller is allowed to know ────────────────────────────────────────

test("a 4xx message reaches the caller, because it is the caller's to fix", async () => {
  const res = errorResponse(badRequest('bad_amount', 'Those amounts add up to $30, but the bill is $45.'));
  assert.equal(res.status, 400);
  const out = await body(res);
  assert.equal(out.error, 'Those amounts add up to $30, but the bill is $45.');
  assert.equal(out.code, 'bad_amount');
});

test('an unexpected throw is replaced entirely, not summarised', async () => {
  // The exact failure that makes this necessary: an upstream message carrying a
  // credential. Trimming or truncating it would still leak; only replacement
  // works.
  const res = errorResponse(new Error('connect ECONNREFUSED db.internal:5432 key=sk_live_abc'));
  assert.equal(res.status, 500);
  const out = await body(res);
  const text = JSON.stringify(out);
  assert.ok(!text.includes('sk_live_abc'), 'a credential must never reach the caller');
  assert.ok(!text.includes('db.internal'), 'an internal hostname must never reach the caller');
  assert.equal(out.code, 'internal');
});

test('a 5xx AppError still says nothing it was not given to say', async () => {
  const error = new AppError('misconfigured', 'Service misconfigured', 500, {
    detail: 'SUPABASE_SERVICE_ROLE_KEY is not set',
  });
  const out = await body(errorResponse(error));
  assert.equal(out.error, 'Service misconfigured');
  // detail is for the logs. It names configuration, and naming which secret is
  // missing tells an attacker what the app runs on.
  assert.ok(!JSON.stringify(out).includes('SUPABASE_SERVICE_ROLE_KEY'));
});

test('the detail on a 4xx is for the logs too, never the response', async () => {
  const error = badRequest('bad_slug', 'That restaurant was not found.', {
    detail: 'slug=acme-diner owner_id=3f9a not in restaurants',
  });
  const out = await body(errorResponse(error));
  assert.equal(out.error, 'That restaurant was not found.');
  assert.ok(!JSON.stringify(out).includes('owner_id'));
});

// ── Traceability ────────────────────────────────────────────────────────────

test('the id is in the body and on the response, so a failure is findable either way', async () => {
  const res = errorResponse(forbidden('not_host', 'Only the host can confirm a payment.'), { id: 'abc123' });
  assert.equal(res.headers.get('X-Request-Id'), 'abc123');
  assert.equal((await body(res)).request_id, 'abc123');
});

test('the same id appears in the log line the caller cannot see', () => {
  capturing((lines) => {
    errorResponse(new Error('kaboom'), { id: 'abc123', route: 'fn/confirmPayment' });
    const line = JSON.parse(lines.at(-1));
    assert.equal(line.request_id, 'abc123');
    assert.equal(line.route, 'fn/confirmPayment');
    // The part that never leaves the log.
    assert.equal(line.message, 'kaboom');
  });
});

test('the log line is JSON, so request_id is a field and not a substring', () => {
  capturing((lines) => {
    logError(badRequest('x', 'y'), { id: '112233', route: 'fn/test' });
    // The whole point: findable with a filter at the moment nobody is calm
    // enough to write a regex.
    assert.doesNotThrow(() => JSON.parse(lines.at(-1)));
  });
});

test('an unexpected error logs a stack; a deliberate one does not', () => {
  capturing((lines) => {
    logError(new Error('kaboom'), { id: '1', route: 'r' });
    assert.ok(JSON.parse(lines.at(-1)).stack, 'an unexpected failure needs its stack');

    logError(forbidden('not_host', 'Only the host can confirm a payment.'), { id: '1', route: 'r' });
    // An AppError is a decision this code made on purpose. Its stack is noise.
    assert.equal(JSON.parse(lines.at(-1)).stack, undefined);
  });
});

test('a 4xx logs at warn and a 5xx at error, so one can be alerted on', () => {
  capturing((lines) => {
    logError(badRequest('x', 'y'), { id: '1', route: 'r' });
    assert.equal(JSON.parse(lines.at(-1)).level, 'warn');
    logError(new Error('kaboom'), { id: '1', route: 'r' });
    assert.equal(JSON.parse(lines.at(-1)).level, 'error');
  });
});

// ── Retry ───────────────────────────────────────────────────────────────────

test('a dependency failure says it is worth trying again', async () => {
  const out = await body(errorResponse(upstream('model_unavailable', 'The receipt reader is busy.')));
  assert.equal(out.retry, true);
  // 502, not 500: the fault is downstream, and that is the difference between a
  // client that offers a retry button and one that gives up.
  assert.equal(publicShape(upstream('x', 'y'), 'id').status, 502);
});

test('a rejected input does not, because retrying it will fail identically', async () => {
  const out = await body(errorResponse(badRequest('bad_email', 'That email address is not valid.')));
  assert.equal(out.retry, undefined);
});

test('an unexpected failure is retryable, since we do not know that it is not', async () => {
  const out = await body(errorResponse(new Error('kaboom')));
  assert.equal(out.retry, true);
});

// ── Responses ───────────────────────────────────────────────────────────────

test('an error response is JSON and is never cached', () => {
  const res = errorResponse(badRequest('x', 'y'));
  assert.match(res.headers.get('content-type'), /application\/json/);
  // These bodies name what somebody did wrong. An intermediary must not keep
  // them.
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('a thrown string does not become a 200', async () => {
  // Not hypothetical: `throw 'nope'` is legal, and code that assumes an Error
  // will read .status off a string and get undefined.
  const res = errorResponse('nope');
  assert.equal(res.status, 500);
  assert.equal((await body(res)).code, 'internal');
});
