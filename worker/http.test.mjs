/**
 * Outbound calls give up.
 *
 * Eleven of the twelve fetches in this Worker had no timeout. A Worker's fetch
 * does not time out on its own, so a wedged dependency held the invocation open
 * until Cloudflare's proxy gave up around a hundred seconds later — which at a
 * table is a diner tapping "I've sent it" and watching nothing happen for over a
 * minute, on a screen that polls every three seconds so the failures stack up.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fetchWithTimeout, TIMEOUTS } from './lib/http.js';

const withFetch = async (impl, run) => {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
};

test('a hung request is abandoned rather than waited on', async () => {
  await withFetch(
    (_url, init) => new Promise((_resolve, reject) => {
      // Never resolves. Rejects only when the signal fires, as fetch does.
      init.signal.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    }),
    async () => {
      const started = Date.now();
      await assert.rejects(
        () => fetchWithTimeout('https://example.test', {}, 50),
        (error) => {
          assert.equal(error.name, 'TimeoutError', 'a timeout is distinguishable from a refusal');
          assert.equal(error.timeout, 50);
          return true;
        },
      );
      assert.ok(Date.now() - started < 1000, 'and it gave up promptly');
    },
  );
});

test('a timeout is not mistaken for an answer', async () => {
  // It throws rather than returning a synthetic response, so no caller can read
  // "gave up" as "replied". db.js turns the throw into a DbError, email.js into
  // { ok: false }, the handlers into a 502.
  await withFetch(
    (_url, init) => new Promise((_r, reject) => {
      init.signal.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    }),
    async () => {
      let response;
      try {
        response = await fetchWithTimeout('https://example.test', {}, 20);
      } catch {
        response = 'threw';
      }
      assert.equal(response, 'threw');
    },
  );
});

test('a request that answers in time is untouched', async () => {
  await withFetch(
    async () => new Response('{"ok":true}', { status: 200 }),
    async () => {
      const res = await fetchWithTimeout('https://example.test', {}, 1000);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { ok: true });
    },
  );
});

test('a real network error stays a network error', async () => {
  // Only an abort becomes a TimeoutError. Rewriting every failure as a timeout
  // would hide the ones worth reading.
  await withFetch(
    async () => { throw new TypeError('network unreachable'); },
    async () => {
      await assert.rejects(
        () => fetchWithTimeout('https://example.test', {}, 1000),
        (error) => {
          assert.equal(error.name, 'TypeError');
          assert.match(error.message, /network unreachable/);
          return true;
        },
      );
    },
  );
});

test("a caller's own signal is left alone", async () => {
  // scan-receipt.js has its own controller and its own reason for the 20s it
  // chose. Wrapping it would silently shorten a budget somebody argued for.
  const controller = new AbortController();
  let sawSignal = null;
  await withFetch(
    async (_url, init) => { sawSignal = init.signal; return new Response('ok'); },
    async () => {
      await fetchWithTimeout('https://example.test', { signal: controller.signal }, 10);
      assert.equal(sawSignal, controller.signal, 'the caller\'s signal was passed through');
    },
  );
});

test('every budget is a number a person would wait', () => {
  for (const [name, ms] of Object.entries(TIMEOUTS)) {
    assert.ok(Number.isFinite(ms) && ms > 0, `${name} must be a positive number`);
    assert.ok(ms <= 30_000, `${name} is ${ms}ms — longer than anyone waits at a table`);
  }
  assert.ok(TIMEOUTS.auth <= TIMEOUTS.database, 'auth is one hop on a hot path');
  assert.ok(TIMEOUTS.payment >= TIMEOUTS.database, 'an abandoned checkout is worse than a slow one');
});

test('no outbound call in the Worker escapes a deadline', async () => {
  // The guard on the whole class. A new bare fetch() is how this comes back.
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = dirname(fileURLToPath(import.meta.url));

  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.js')) files.push(full);
    }
  };
  walk(root);

  for (const file of files) {
    // http.js is where the one permitted bare fetch lives, and scan-receipt.js
    // brings its own AbortController — both are the exception, stated.
    if (file.endsWith('lib/http.js') || file.endsWith('routes/scan-receipt.js')) continue;
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(
      source,
      /(?<!WithTimeout)\bawait fetch\(/,
      `${file.replace(root, 'worker')} calls fetch() without a deadline — use fetchWithTimeout`,
    );
  }
});
