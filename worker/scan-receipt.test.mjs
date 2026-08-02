/**
 * The receipt parse, straight to the model.
 *
 * This route exists to take Base44 out of the critical path: the scan was two
 * sequential round trips with their storage and their gateway in the middle of
 * both, and the image crossed the wire twice. What is tested here is mostly the
 * unhappy paths, because the happy one is a single fetch — and because the
 * whole point of the fallback is that this route can fail without the diner
 * losing their receipt.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost as scanReceipt } from './routes/scan-receipt.js';

const KEY_ENV = { GEMINI_API_KEY: 'test-key', GEMINI_MODEL: 'test-model' };

const imageRequest = (bytes = new Uint8Array([1, 2, 3]), type = 'image/webp') =>
  new Request('https://billtap.app/api/scan-receipt', {
    method: 'POST',
    headers: { 'Content-Type': type },
    body: bytes,
  });

/** Stands in for the model, capturing what it was sent. */
function stubModel(reply, status = 200) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(reply), { status });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const modelSaid = (obj) => ({
  candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }],
});

const RECEIPT = {
  title: 'Olive Garden',
  items: [{ name: 'Chicken Alfredo', price: 19.95, quantity: 1 }],
  tax: 1.65, tip: 0, total: 21.6,
};

// ── Not configured ──────────────────────────────────────────────────────────

test('with no key it reports that clearly, so the client can fall back', async () => {
  // Deployable before the key exists. The client reads this code and quietly
  // goes back to the Base44 path rather than showing a failure.
  const res = await scanReceipt({ request: imageRequest(), env: {} });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, 'not_configured');
});

// ── What it sends ───────────────────────────────────────────────────────────

test('the image goes inline, so there is no upload to wait for', async () => {
  const stub = stubModel(modelSaid(RECEIPT));
  try {
    await scanReceipt({ request: imageRequest(new Uint8Array([1, 2, 3, 4])), env: KEY_ENV });
    const [call] = stub.calls;

    const parts = call.body.contents[0].parts;
    const inline = parts.find((p) => p.inlineData);
    assert.ok(inline, 'the bytes travel with the request');
    assert.equal(inline.inlineData.mimeType, 'image/webp');
    assert.equal(inline.inlineData.data, 'AQIDBA==');
    assert.ok(!JSON.stringify(call.body).includes('file_url'), 'no URL round trip');
  } finally { stub.restore(); }
});

test('the model is asked for structured JSON at zero temperature', async () => {
  const stub = stubModel(modelSaid(RECEIPT));
  try {
    await scanReceipt({ request: imageRequest(), env: KEY_ENV });
    const config = stub.calls[0].body.generationConfig;
    assert.equal(config.responseMimeType, 'application/json');
    assert.ok(config.responseSchema, 'a schema, so the shape is not left to chance');
    assert.equal(config.temperature, 0, 'reading printed numbers is not a creative task');
    assert.ok(config.maxOutputTokens > 0, 'unbounded lets a bad response run long');
  } finally { stub.restore(); }
});

test('the model is configurable, because model names change', async () => {
  const stub = stubModel(modelSaid(RECEIPT));
  try {
    await scanReceipt({ request: imageRequest(), env: { ...KEY_ENV, GEMINI_MODEL: 'some-newer-model' } });
    assert.match(stub.calls[0].url, /models\/some-newer-model:generateContent/);
  } finally { stub.restore(); }
});

test('the key travels as a header, never in the URL', async () => {
  // A key in a query string lands in every access log between here and there.
  const stub = stubModel(modelSaid(RECEIPT));
  try {
    await scanReceipt({ request: imageRequest(), env: KEY_ENV });
    assert.equal(stub.calls[0].init.headers['x-goog-api-key'], 'test-key');
    assert.ok(!stub.calls[0].url.includes('test-key'));
  } finally { stub.restore(); }
});

// ── What it returns ─────────────────────────────────────────────────────────

test('a parsed receipt comes back in the shape the review screen expects', async () => {
  const stub = stubModel(modelSaid(RECEIPT));
  try {
    const res = await scanReceipt({ request: imageRequest(), env: KEY_ENV });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), RECEIPT);
  } finally { stub.restore(); }
});

test('a missing quantity becomes one, and missing money becomes zero', async () => {
  const stub = stubModel(modelSaid({ title: 'X', items: [{ name: 'Tea', price: 3 }] }));
  try {
    const out = await (await scanReceipt({ request: imageRequest(), env: KEY_ENV })).json();
    assert.equal(out.items[0].quantity, 1);
    assert.equal(out.tax, 0);
    assert.equal(out.total, 0);
  } finally { stub.restore(); }
});

test('a nameless response still gets a title, so the screen has a heading', async () => {
  const stub = stubModel(modelSaid({ items: [], tax: 0, tip: 0, total: 0 }));
  try {
    const out = await (await scanReceipt({ request: imageRequest(), env: KEY_ENV })).json();
    assert.equal(out.title, 'Receipt');
  } finally { stub.restore(); }
});

test('junk in the items array is dropped rather than rendered', async () => {
  const stub = stubModel(modelSaid({ title: 'X', items: [null, 'nope', { name: 'Real', price: 5 }] }));
  try {
    const out = await (await scanReceipt({ request: imageRequest(), env: KEY_ENV })).json();
    assert.equal(out.items.length, 1);
    assert.equal(out.items[0].name, 'Real');
  } finally { stub.restore(); }
});

test('an absurdly long item name is truncated, not rendered off the screen', async () => {
  const stub = stubModel(modelSaid({ title: 'X', items: [{ name: 'x'.repeat(500), price: 1 }] }));
  try {
    const out = await (await scanReceipt({ request: imageRequest(), env: KEY_ENV })).json();
    assert.equal(out.items[0].name.length, 120);
  } finally { stub.restore(); }
});

// ── Failing ─────────────────────────────────────────────────────────────────

test('a rejected image type is refused before any money is spent', async () => {
  const res = await scanReceipt({
    request: new Request('https://billtap.app/api/scan-receipt', {
      method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: 'x',
    }),
    env: KEY_ENV,
  });
  assert.equal(res.status, 415);
});

test('an empty body is refused', async () => {
  const res = await scanReceipt({
    request: new Request('https://billtap.app/api/scan-receipt', {
      method: 'POST', headers: { 'Content-Type': 'image/webp' },
    }),
    env: KEY_ENV,
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'empty');
});

test('an oversized image is refused rather than sent', async () => {
  const res = await scanReceipt({
    request: imageRequest(new Uint8Array(9 * 1024 * 1024)),
    env: KEY_ENV,
  });
  assert.equal(res.status, 413);
});

test('a model error is a code the client can fall back on', async () => {
  const stub = stubModel({ error: { message: 'quota' } }, 429);
  try {
    const res = await scanReceipt({ request: imageRequest(), env: KEY_ENV });
    assert.equal(res.status, 502);
    assert.equal((await res.json()).code, 'model_error');
  } finally { stub.restore(); }
});

test('a response with no text — a safety block — is handled', async () => {
  const stub = stubModel({ candidates: [{ finishReason: 'SAFETY' }] });
  try {
    const res = await scanReceipt({ request: imageRequest(), env: KEY_ENV });
    assert.equal((await res.json()).code, 'empty_response');
  } finally { stub.restore(); }
});

test('a response that is not JSON does not take the Worker down', async () => {
  const stub = stubModel({ candidates: [{ content: { parts: [{ text: 'Sorry, I cannot' }] } }] });
  try {
    const res = await scanReceipt({ request: imageRequest(), env: KEY_ENV });
    assert.equal((await res.json()).code, 'bad_json');
  } finally { stub.restore(); }
});

test('an unreachable provider fails fast instead of hanging', async () => {
  // A scan that hangs is worse than one that fails: the diner is watching a
  // spinner and the table is waiting.
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
  try {
    const res = await scanReceipt({ request: imageRequest(), env: KEY_ENV });
    assert.equal(res.status, 504);
    assert.equal((await res.json()).code, 'network');
  } finally { globalThis.fetch = original; }
});

test('no failure path leaks the API key to the client', async () => {
  const stub = stubModel({ error: { message: 'bad key test-key' } }, 401);
  try {
    const res = await scanReceipt({ request: imageRequest(), env: KEY_ENV });
    assert.ok(!JSON.stringify(await res.json()).includes('test-key'));
  } finally { stub.restore(); }
});
