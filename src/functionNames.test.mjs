/**
 * Every /api/fn/<name> the app calls must be a handler the Worker has.
 *
 * ── The bug that went unnoticed for the life of the feature ─────────────────
 *
 * NewReceipt.jsx fetched `/api/fn/list-restaurants`. The handler is, and always
 * was, `listRestaurants`. The fn map dispatches on an exact key — HANDLERS[name]
 * — so every one of those requests 404'd, and the caller caught it with the
 * comment "Silent fail — optional feature". An empty restaurant list renders as
 * no picker rather than as an error, so the "which restaurant are you at?"
 * question never appeared for anyone who opened the app without scanning a
 * table tent.
 *
 * It was found by reading production traffic, not by a test. Every test that
 * touches that screen stubs the fetch, which is exactly the blind spot: a
 * mocked call cannot disagree with the server about a name.
 *
 * This compares the two lists as text. It needs no browser, no stub and no
 * running Worker, and it fails on a typo the moment it is written.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(jsx?|mjs)$/.test(entry) && !entry.endsWith('.test.mjs')) out.push(full);
  }
  return out;
}

/** The keys of the HANDLERS object in worker/routes/functions.js. */
function handlerNames() {
  const src = readFileSync(join(ROOT, 'worker/routes/functions.js'), 'utf8');
  const at = src.search(/const HANDLERS\s*=\s*\{/);
  assert.ok(at > -1, 'could not find the HANDLERS map — this test needs rewriting');
  const body = src.slice(at);
  // `if (` and friends would match the same shape, so control-flow keywords are
  // excluded rather than the regex made cleverer.
  const reserved = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function']);
  return new Set(
    [...body.matchAll(/^ {2}(?:async )?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/gm)]
      .map((m) => m[1])
      .filter((n) => !reserved.has(n)),
  );
}

test('the Worker exposes a plausible number of handlers', () => {
  // Guards the parse above: if the regex stops matching, every other assertion
  // in this file passes vacuously.
  assert.ok(handlerNames().size >= 15, `only parsed ${handlerNames().size} handlers`);
});

test('every function the app calls exists on the Worker', () => {
  const handlers = handlerNames();
  const missing = [];

  for (const file of walk(join(ROOT, 'src'))) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\/api\/fn\/([A-Za-z][A-Za-z0-9_-]*)/g)) {
      if (!handlers.has(m[1])) {
        missing.push(`${file.replace(ROOT, '')} calls /api/fn/${m[1]}`);
      }
    }
  }

  assert.deepEqual(missing, [], `these 404 at runtime:\n  ${missing.join('\n  ')}\n\nhandlers: ${[...handlers].sort().join(', ')}`);
});
