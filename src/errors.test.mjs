/**
 * What the browser tells somebody when a request fails.
 *
 * These replaced nine alert() calls, seven of them saying some version of
 * "please try again". The point of the replacement is that the sentence is
 * true: it names what actually failed, and it only offers a retry when
 * repeating the request could plausibly work.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { describeError, isRetryable } from './lib/errors.js';

// ── The server's sentence wins ──────────────────────────────────────────────

test("the server's message is used, because it has the amounts and the names", () => {
  const out = describeError({
    status: 400,
    data: {
      error: 'Those amounts add up to $30.00, but the bill is $45.00.',
      code: 'bad_amount',
      request_id: '4f2a91',
    },
  });
  // A generic "Failed to create session" here would throw away the two numbers
  // that tell the host what to fix.
  assert.equal(out.message, 'Those amounts add up to $30.00, but the bill is $45.00.');
  assert.equal(out.requestId, '4f2a91');
});

test('the request id comes through, because it is the whole support conversation', () => {
  const out = describeError({ status: 500, data: { error: 'x', code: 'internal', request_id: 'abc123' } });
  assert.equal(out.requestId, 'abc123');
});

// ── Retry is offered only when it could work ────────────────────────────────

test('a rejected input offers no retry, since repeating it fails identically', () => {
  const out = describeError({ status: 400, data: { error: 'That email address is not valid.', code: 'bad_email' } });
  assert.equal(out.retry, false);
});

test('a dependency failure does offer one', () => {
  const out = describeError({ status: 502, data: { error: 'The receipt reader is busy.', code: 'model_unavailable', retry: true } });
  assert.equal(out.retry, true);
});

test('a response with no retry field is treated as no', () => {
  // An old deploy, or a failure from in front of the Worker. Offering a button
  // that cannot help trains people to press it.
  const out = describeError({ status: 500, data: { error: 'x', code: 'internal' } });
  assert.equal(out.retry, false);
});

test('a 429 is retryable even though it is a 4xx', () => {
  // It is a statement about timing, not about the request.
  assert.equal(isRetryable({ status: 429 }), true);
  assert.equal(isRetryable({ status: 400 }), false);
  assert.equal(isRetryable({ status: 403 }), false);
  assert.equal(isRetryable({ status: 500 }), true);
  assert.equal(isRetryable({}), true);
});

// ── Being offline is not the same as being broken ───────────────────────────

test('no connection is named as such, not reported as a server error', () => {
  // A thrown TypeError from fetch, which is what a dropped connection looks
  // like. Telling somebody at a table with no signal to "try again" is worse
  // than telling them why.
  const out = describeError(new TypeError('Failed to fetch'));
  assert.equal(out.code, 'offline');
  assert.match(out.message, /No connection/);
  assert.match(out.advice, /nothing was lost/i);
  assert.equal(out.retry, true);
});

test('an offline failure has no request id, because it never reached us', () => {
  const out = describeError(new TypeError('Failed to fetch'));
  assert.equal(out.requestId, null);
});

// ── Advice, where the app knows something the server does not ───────────────

test('an unreadable scan gets advice about the photo, which is the actual fix', () => {
  const out = describeError({ status: 422, data: { error: 'Could not read that receipt.', code: 'scan_unreadable' } });
  assert.match(out.advice, /light/);
});

test('an internal failure says nothing was charged, which is what a diner is asking', () => {
  const out = describeError({ status: 500, data: { error: 'Something went wrong.', code: 'internal' } });
  assert.match(out.advice, /Nothing was charged or changed/);
});

test('a code with no advice simply has none, rather than inventing some', () => {
  const out = describeError({ status: 400, data: { error: 'Nothing to change', code: 'nothing_to_change' } });
  assert.equal(out.advice, null);
});

// ── Nothing throws on the way to the screen ─────────────────────────────────

test('a failure with no body still produces something renderable', () => {
  const out = describeError({ status: 500 });
  assert.ok(out.message);
  assert.equal(typeof out.retry, 'boolean');
});

test('undefined does not crash the component that renders it', () => {
  const out = describeError(undefined);
  assert.ok(out.message);
});
