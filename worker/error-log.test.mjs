/**
 * Tests for error-log.js URL normalization and PostgREST error logging.
 *
 * The key fix: SUPABASE_URL may have trailing slashes, so we must normalize
 * it before building the PostgREST path to avoid malformed URLs like
 * `https://p.supabase.co//rest/v1/error_log` (double slash after domain).
 *
 * Also tests that recordError() never throws, even if the write fails.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { recordError, buildRow, severityOf, summarise } from './lib/error-log.js';

// Mock fetch to capture what URL is being called
function stubFetch() {
  const requests = [];
  const original = globalThis.fetch;

  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    // Simulate success by default
    return new Response('{}', { status: 201 });
  };

  return { requests, restore: () => { globalThis.fetch = original; } };
}

// ── URL normalization ──────────────────────────────────────────────────

test('recordError normalizes SUPABASE_URL by stripping trailing slashes', async () => {
  const stub = stubFetch();
  try {
    const env = {
      SUPABASE_URL: 'https://p.supabase.co/',
      SUPABASE_SERVICE_ROLE_KEY: 'key123',
      ENVIRONMENT: 'test',
    };

    const error = new Error('test');
    const result = recordError(env, null, error, { route: '/api/test', method: 'POST' });

    assert.equal(result, true, 'recordError should return true');
    assert.equal(stub.requests.length, 1);
    assert.equal(
      stub.requests[0].url,
      'https://p.supabase.co/rest/v1/error_log',
      'URL should not have double slash after domain'
    );
  } finally {
    stub.restore();
  }
});

test('recordError handles multiple trailing slashes', async () => {
  const stub = stubFetch();
  try {
    const env = {
      SUPABASE_URL: 'https://p.supabase.co///',
      SUPABASE_SERVICE_ROLE_KEY: 'key123',
      ENVIRONMENT: 'test',
    };

    recordError(env, null, new Error('test'), { route: '/api/test', method: 'POST' });

    assert.equal(
      stub.requests[0].url,
      'https://p.supabase.co/rest/v1/error_log',
      'Multiple trailing slashes should be stripped'
    );
  } finally {
    stub.restore();
  }
});

test('recordError works with URLs that have no trailing slash', async () => {
  const stub = stubFetch();
  try {
    const env = {
      SUPABASE_URL: 'https://p.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'key123',
      ENVIRONMENT: 'test',
    };

    recordError(env, null, new Error('test'), { route: '/api/test', method: 'POST' });

    assert.equal(
      stub.requests[0].url,
      'https://p.supabase.co/rest/v1/error_log',
      'URL without trailing slash should work fine'
    );
  } finally {
    stub.restore();
  }
});

// ── Robustness: never throws ──────────────────────────────────────────

test('recordError returns false gracefully if SUPABASE_URL is missing', () => {
  const env = { SUPABASE_SERVICE_ROLE_KEY: 'key123' };
  const result = recordError(env, null, new Error('test'), {});
  assert.equal(result, false, 'Should return false, not throw');
});

test('recordError returns false gracefully if SUPABASE_SERVICE_ROLE_KEY is missing', () => {
  const env = { SUPABASE_URL: 'https://p.supabase.co' };
  const result = recordError(env, null, new Error('test'), {});
  assert.equal(result, false, 'Should return false, not throw');
});

test('recordError never throws, even on internal error during URL normalization', () => {
  const stub = stubFetch();
  try {
    const env = {
      // Simulate a weird URL that might cause issues
      SUPABASE_URL: 'https://p.supabase.co  \n  ',
      SUPABASE_SERVICE_ROLE_KEY: 'key123',
      ENVIRONMENT: 'test',
    };

    // Should not throw
    const result = recordError(env, null, new Error('test'), {});
    assert.equal(typeof result, 'boolean', 'recordError should return a boolean');
  } finally {
    stub.restore();
  }
});

// ── buildRow creates the correct structure ──────────────────────────────

test('buildRow includes request_id, route, method, status, code, and message', () => {
  const error = new Error('Something went wrong');
  error.name = 'AppError';
  error.code = 'RESOURCE_NOT_FOUND';
  error.status = 404;

  const row = buildRow(error, {
    id: 'req123',
    route: '/api/test',
    method: 'POST',
    status: 404,
  });

  assert.equal(row.request_id, 'req123');
  assert.equal(row.route, '/api/test');
  assert.equal(row.method, 'POST');
  assert.equal(row.status, 404);
  assert.equal(row.code, 'RESOURCE_NOT_FOUND');
  assert.ok(row.message.includes('Something went wrong'));
});

test('buildRow includes session_ref from request headers', () => {
  const request = {
    headers: new Map([['x-billtap-participant', 'session-abc123']]),
  };
  request.headers.get = (key) => new Map([['x-billtap-participant', 'session-abc123']]).get(key.toLowerCase());

  const row = buildRow(new Error('test'), {
    route: '/api/test',
    method: 'GET',
    request,
  });

  assert.equal(row.session_ref, 'session-abc123');
});

test('buildRow truncates long routes to 200 chars', () => {
  const longRoute = '/api/' + 'x'.repeat(300);
  const row = buildRow(new Error('test'), { route: longRoute, method: 'GET' });

  assert.equal(row.route.length, 200);
});

test('buildRow truncates stack to first 20 lines and 4000 chars', () => {
  const longStack = 'Error: test\n' + Array(30).fill('  at function (file.js:1:1)').join('\n');
  const error = new Error('test');
  error.stack = longStack;

  const row = buildRow(error, { route: '/api/test', method: 'GET' });

  const lines = row.stack.split('\n').filter(l => l.length > 0);
  assert.ok(lines.length <= 20, 'Stack should be limited to ~20 lines');
  assert.ok(row.stack.length <= 4000, 'Stack should be limited to 4000 chars');
});

// ── severityOf categorizes errors correctly ────────────────────────────

test('severityOf returns "warn" for AppError with status < 500', () => {
  const error = new Error();
  error.name = 'AppError';
  error.status = 400;

  const severity = severityOf(error, 400);
  assert.equal(severity, 'warn');
});

test('severityOf returns "error" for AppError with status >= 500', () => {
  const error = new Error();
  error.name = 'AppError';
  error.status = 500;

  const severity = severityOf(error, 500);
  assert.equal(severity, 'error');
});

test('severityOf returns "error" for non-AppError with status < 500', () => {
  const error = new Error('something');
  const severity = severityOf(error, 400);
  assert.equal(severity, 'error');
});

test('severityOf returns "fatal" for non-AppError with status >= 500', () => {
  const error = new Error('something');
  const severity = severityOf(error, 500);
  assert.equal(severity, 'fatal');
});

// ── summarise redacts sensitive fields ──────────────────────────────────

test('summarise withholds sensitive fields like password and token', () => {
  const body = {
    status: 'active',
    password: 'secret123',
    token: 'tok_abc',
    apikey: 'key_xyz',
  };

  const summary = summarise(body);

  assert.equal(summary.status, 'active', 'allowed scalar field preserved');
  assert.equal(summary.password, '[withheld]', 'password withheld');
  assert.equal(summary.token, '[withheld]', 'token withheld');
  assert.equal(summary.apikey, '[withheld]', 'apikey withheld');
});

test('summarise preserves allowed scalar fields', () => {
  const body = {
    split_mode: 'even',
    status: 'pending',
    action: 'create',
    quantity: 5,
  };

  const summary = summarise(body);

  assert.equal(summary.split_mode, 'even');
  assert.equal(summary.status, 'pending');
  assert.equal(summary.action, 'create');
  assert.equal(summary.quantity, 5);
});

test('summarise truncates string values over 40 chars', () => {
  const body = { comment: 'x'.repeat(100) };
  const summary = summarise(body);

  assert.ok(summary.comment.startsWith('string('));
  assert.ok(summary.comment.includes('100'));
});

test('summarise shows array length and first element shape', () => {
  const body = {
    items: [
      { id: 'item1', name: 'first' },
      { id: 'item2', name: 'second' },
    ],
  };

  const summary = summarise(body);

  assert.equal(summary.items.array, 2);
  assert.ok(summary.items.of);
  assert.ok(summary.items.of.id);
  assert.ok(summary.items.of.name);
});
