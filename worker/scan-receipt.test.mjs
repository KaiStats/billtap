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
import { readFileSync } from 'node:fs';

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

// ── Real model output, replayed ─────────────────────────────────────────────
//
// Every payload below was returned by the live model for a rendered receipt in
// that POS's format, captured on 2026-08-15 by posting the images to the
// deployed endpoint. Replaying them here is the difference between "the prompt
// asks for a table" and "the model returns one we handle correctly" — and it
// pins the shapes, so a prompt edit that starts producing something else fails
// here rather than in an operator's inbox.
//
// The images are not committed: they are six thermal receipts rendered from
// HTML, reproducible from the formats described in each case below.

const OBSERVED = [
  {
    pos: 'Toast — "Table 14", server on its own line',
    said: { title: 'HERB & RYE', items: [{ name: 'Ribeye', price: 48, quantity: 1 }], tax: 7.4, tip: 0, total: 87.4,
      ticket: { table: '14', server: 'Marco', number: '4471' } },
    want: { table: '14', server: 'Marco', number: '4471' },
  },
  {
    pos: 'Square — "TBL 7" abbreviated, "Cashier" not "Server"',
    said: { title: 'THE GOLDEN STEER', items: [], tax: 5.61, tip: 0, total: 73.61,
      ticket: { table: '7', server: 'Danielle', number: '00219' } },
    // Leading zeros survive: "00219" is a string, and a check number that
    // became 219 would not match what is printed on the ticket.
    want: { table: '7', server: 'Danielle', number: '00219' },
  },
  {
    pos: 'Aloha — table, server and order crammed on one line',
    said: { title: 'CARSON KITCHEN', items: [], tax: 3.22, tip: 0, total: 42.22,
      ticket: { table: '22/1', server: '08 MARIA', number: '1187' } },
    // "22/1" is table 22 seat 1 and "08 MARIA" carries the server's POS code.
    // Both are kept verbatim: what is printed is what the manager will see on
    // their own screen, and tidying it is how the two stop matching.
    want: { table: '22/1', server: '08 MARIA', number: '1187' },
  },
  {
    pos: 'Micros — lettered table, server named in prose',
    said: { title: "ESTHER'S KITCHEN", items: [], tax: 3.8, tip: 0, total: 49.8,
      ticket: { table: 'A7', server: 'JULIAN', number: '8823' } },
    // The one that would break any integer parse.
    want: { table: 'A7', server: 'JULIAN', number: '8823' },
  },
  {
    pos: 'Bar tab — a seat rather than a table, a bartender rather than a server',
    said: { title: 'ATOMIC LIQUORS', items: [], tax: 1.24, tip: 0, total: 16.24,
      ticket: { table: 'BAR 3', server: 'Kenny', number: '552' } },
    want: { table: 'BAR 3', server: 'Kenny', number: '552' },
  },
  {
    pos: 'Counter service — nothing printed, and nothing invented',
    said: { title: 'RAKU EXPRESS', items: [], tax: 1.32, tip: 0, total: 17.32 },
    // The important one. A model asked for a required field invents one, and an
    // invented table sends a manager to apologise to the wrong people while the
    // guest who was actually unhappy finishes their coffee and leaves.
    want: null,
  },
];

for (const { pos, said, want } of OBSERVED) {
  test(`real model output: ${pos}`, async () => {
    const s = stubModel(modelSaid(said));
    try {
      const res = await scanReceipt({ request: imageRequest(), env: { GEMINI_API_KEY: 'k' } });
      assert.equal(res.status, 200);
      const out = await res.json();
      if (want === null) {
        assert.equal(out.ticket, undefined, 'no ticket key at all, not an empty object');
      } else {
        assert.deepEqual(out.ticket, want);
      }
    } finally { s.restore(); }
  });
}

test('the prompt still asks for the ticket fields', () => {
  // A drift guard on the instruction itself. The replays above prove the
  // handling; this catches a prompt edit that quietly stops asking, which the
  // replays could not — they feed the answer in.
  const src = readFileSync(new URL('./routes/scan-receipt.js', import.meta.url), 'utf8');
  for (const needle of ['ticket.table', 'ticket.server', 'ticket.number', 'Omit']) {
    assert.ok(src.includes(needle), `the prompt no longer mentions ${needle}`);
  }
});

// ── Stalls ──────────────────────────────────────────────────────────────────
//
// Measured against the live model: every success came back between 1.6 and 6.7
// seconds and the one failure sat until it hit the deadline. Failures are
// stalls, not slow answers, so the fix is a second short attempt rather than a
// longer first one — two at ATTEMPT_MS is a worse case below the single
// twenty-second attempt this replaced.

/** Fails the first n calls with an abort, then answers. */
function stubStalls(n, reply) {
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls <= n) {
      const e = new Error('The operation was aborted');
      e.name = 'AbortError';
      throw e;
    }
    return new Response(JSON.stringify(reply), { status: 200 });
  };
  return { count: () => calls, restore: () => { globalThis.fetch = original; } };
}

test('a stalled first attempt is retried rather than costing the diner the scan', async () => {
  const s = stubStalls(1, modelSaid({ ...RECEIPT, ticket: { table: '14' } }));
  try {
    const res = await scanReceipt({ request: imageRequest(), env: KEY_ENV });
    assert.equal(res.status, 200, 'the second attempt answered');
    assert.equal((await res.json()).ticket.table, '14');
    assert.equal(s.count(), 2, 'exactly one retry, not a loop');
  } finally { s.restore(); }
});

test('two stalls give up, so a wedged provider cannot hold the table forever', async () => {
  const s = stubStalls(2, modelSaid(RECEIPT));
  try {
    const res = await scanReceipt({ request: imageRequest(), env: KEY_ENV });
    assert.equal(res.status, 504);
    assert.equal((await res.json()).code, 'timeout', 'the code the client falls back on');
    assert.equal(s.count(), 2, 'it does not keep trying');
  } finally { s.restore(); }
});

test('a quota rejection is not retried — asking again spends money to be refused twice', async () => {
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { message: 'quota' } }), { status: 429 });
  };
  try {
    const res = await scanReceipt({ request: imageRequest(), env: KEY_ENV });
    assert.equal(res.status, 502);
    assert.equal((await res.json()).code, 'model_error');
    assert.equal(calls, 1, 'a 429 is an answer, not a stall');
  } finally { globalThis.fetch = original; }
});

test('a safety block is not retried either, being deterministic', async () => {
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'SAFETY' }] }), { status: 200 });
  };
  try {
    const res = await scanReceipt({ request: imageRequest(), env: KEY_ENV });
    assert.equal((await res.json()).code, 'empty_response');
    assert.equal(calls, 1, 'it will block again; a retry is a wasted call');
  } finally { globalThis.fetch = original; }
});

test('a genuine network failure is not mistaken for a stall', async () => {
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => { calls += 1; throw new Error('ECONNREFUSED'); };
  try {
    const res = await scanReceipt({ request: imageRequest(), env: KEY_ENV });
    assert.equal((await res.json()).code, 'network');
    assert.equal(calls, 1, 'only an abort earns the second attempt');
  } finally { globalThis.fetch = original; }
});

test('two attempts cost less than the twenty seconds they replace', () => {
  const src = readFileSync(new URL('./routes/scan-receipt.js', import.meta.url), 'utf8');
  const ms = Number(src.match(/const ATTEMPT_MS = (\d+)/)?.[1]);
  assert.ok(Number.isFinite(ms), 'ATTEMPT_MS is not a literal any more');
  assert.ok(ms * 2 < 20000, `two attempts at ${ms}ms is worse than the single 20s it replaced`);
  assert.ok(ms > 6700, 'the slowest measured success was 6.7s; a real answer must not be cut off');
});
