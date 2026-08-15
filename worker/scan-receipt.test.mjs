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

import { onRequestPost as scanReceipt, ticketFrom } from './routes/scan-receipt.js';

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

// ── What the POS printed at the top of the ticket ───────────────────────────
//
// The low-rating alert could say "somebody in this room is unhappy" and nothing
// about which of forty tables. The receipt almost always prints TABLE / SERVER
// / CHK across the top and the scan already has the image in front of a model
// reading everything below it. See supabase/migrations/0015.

test('a printed table, server and check number are carried through', () => {
  assert.deepEqual(
    ticketFrom({ table: '14', server: 'Marco', number: '4471' }),
    { table: '14', server: 'Marco', number: '4471' },
  );
});

test('a table is whatever the room calls it, not an integer', () => {
  // Every restaurant numbers its floor differently and none of them asked us.
  // Parsing to a number fails on exactly the rooms that need this most.
  for (const table of ['14', 'A7', 'BAR 3', 'PATIO-2', 'P12']) {
    assert.equal(ticketFrom({ table })?.table, table);
  }
});

test('nothing printed means no ticket at all, not three empties', () => {
  // The alert branches on the object existing. Three empty strings would make
  // "the receipt printed no table" look like "the table is blank".
  assert.equal(ticketFrom({}), null);
  assert.equal(ticketFrom({ table: '', server: '   ', number: '' }), null);
  assert.equal(ticketFrom(null), null);
  assert.equal(ticketFrom(undefined), null);
  assert.equal(ticketFrom('TABLE 14'), null, 'a string is not the shape');
  assert.equal(ticketFrom(42), null);
});

test('a field the model did not return is absent rather than empty', () => {
  assert.deepEqual(ticketFrom({ table: '14' }), { table: '14' });
  assert.deepEqual(ticketFrom({ server: 'Marco' }), { server: 'Marco' });
});

test('a model that returns a sentence does not get it into an inbox', () => {
  /**
   * The caps are the point rather than tidiness. This is model output — the
   * least trustworthy string in the product — and it lands in an operator's
   * email under the heading that tells them where to walk. A paragraph read
   * off the receipt and handed back as a table number must be cut down, not
   * printed.
   */
  const essay = 'Thank you for dining with us today at our fine establishment, please come again';
  assert.equal(ticketFrom({ table: essay }).table.length, 16);
  assert.equal(ticketFrom({ server: essay }).server.length, 40);
  assert.equal(ticketFrom({ number: essay }).number.length, 24);
});

test('control characters are stripped rather than failing the whole scan', () => {
  // Nobody is watching this get read back, so a refusal informs no one — and
  // dropping the scan over a stray byte would cost the diner their receipt.
  const dirty = `1${String.fromCharCode(0)}4${String.fromCharCode(9)}`;
  assert.equal(ticketFrom({ table: dirty }).table, '14');
  // A value that is *only* control characters is nothing, not an empty table.
  assert.equal(ticketFrom({ table: String.fromCharCode(0, 1, 2) }), null);
});

test('non-string values are refused rather than coerced', () => {
  // A model handing back `{ table: 14 }` is a different bug from one handing
  // back a sentence, and String(14) would hide it.
  assert.equal(ticketFrom({ table: 14 }), null);
  assert.equal(ticketFrom({ table: {} }), null);
  assert.equal(ticketFrom({ table: ['14'] }), null);
});
