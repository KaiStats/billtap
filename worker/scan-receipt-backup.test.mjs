/**
 * The Claude backup reader: used only when Gemini fails or its numbers do not
 * add up, and never allowed to replace a good answer with a worse one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost as scanReceipt, jsonFrom } from './routes/scan-receipt.js';

const ENV = { GEMINI_API_KEY: 'g', GEMINI_MODEL: 'test-model', ANTHROPIC_API_KEY: 'a' };

const req = (type = 'image/jpeg') => new Request('https://billtap.app/api/scan-receipt', {
  method: 'POST', headers: { 'Content-Type': type }, body: new Uint8Array([1, 2, 3]),
});

const GOOD = { title: 'Diner', items: [{ name: 'Burger', price: 15, quantity: 1 }], tax: 1.5, tip: 3, total: 19.5 };
const BAD = { title: 'Diner', items: [{ name: 'Burger', price: 51, quantity: 1 }], tax: 1.5, tip: 3, total: 19.5 };

const geminiSaid = (obj) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] });
const claudeSaid = (obj, stop = 'end_turn') => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: stop,
  content: [{ type: 'text', text: `Here it is:\n${JSON.stringify(obj)}` }],
  usage: { input_tokens: 1, output_tokens: 1 },
});

function stub({ gemini, geminiStatus = 200, claude, claudeStatus = 200 }) {
  const original = globalThis.fetch;
  const calls = { gemini: 0, claude: [] };
  globalThis.fetch = async (url, init = {}) => {
      const u = String(url instanceof Request ? url.url : url);
    if (u.includes('generativelanguage')) {
      calls.gemini++;
      return new Response(JSON.stringify(gemini), { status: geminiStatus });
    }
    if (u.includes('api.anthropic.com')) {
      const body = JSON.parse(init.body);
      calls.claude.push(body);
      return new Response(JSON.stringify(claude), { status: claudeStatus, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected fetch ${u}`);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test('Gemini busy: Claude reads the receipt instead of the guest seeing "busy"', async () => {
  const s = stub({ gemini: { error: 'quota' }, geminiStatus: 429, claude: claudeSaid(GOOD) });
  try {
    const res = await scanReceipt({ request: req(), env: ENV });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.items[0].name, 'Burger');
    assert.equal(s.calls.claude[0].model, 'claude-sonnet-5-5');
    assert.equal(s.calls.claude[0].messages[0].content[0].source.media_type, 'image/jpeg');
  } finally { s.restore(); }
});

test('Gemini numbers do not add up: Claude re-reads, and its reconciling answer wins', async () => {
  const s = stub({ gemini: geminiSaid(BAD), claude: claudeSaid(GOOD) });
  try {
    const data = await (await scanReceipt({ request: req(), env: ENV })).json();
    assert.equal(data.items[0].price, 15);
  } finally { s.restore(); }
});

test('both fail the check: Gemini\'s answer comes back unchanged', async () => {
  const s = stub({ gemini: geminiSaid(BAD), claude: claudeSaid({ ...BAD, title: 'Claude' }) });
  try {
    const data = await (await scanReceipt({ request: req(), env: ENV })).json();
    assert.equal(data.title, 'Diner');
  } finally { s.restore(); }
});

test('a good Gemini read never calls Claude', async () => {
  const s = stub({ gemini: geminiSaid(GOOD), claude: claudeSaid(BAD) });
  try {
    const data = await (await scanReceipt({ request: req(), env: ENV })).json();
    assert.equal(data.items[0].price, 15);
    assert.equal(s.calls.claude.length, 0);
  } finally { s.restore(); }
});

test('Claude failing too returns Gemini\'s original error, not a worse one', async () => {
  const s = stub({ gemini: { error: 'quota' }, geminiStatus: 429, claude: { type: 'error', error: { type: 'overloaded_error', message: 'x' } }, claudeStatus: 529 });
  try {
    const res = await scanReceipt({ request: req(), env: ENV });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).code, 'busy');
  } finally { s.restore(); }
});

test('without the Anthropic key, or for a HEIC photo, nothing changes', async () => {
  const s = stub({ gemini: { error: 'quota' }, geminiStatus: 429, claude: claudeSaid(GOOD) });
  try {
    const noKey = await scanReceipt({ request: req(), env: { ...ENV, ANTHROPIC_API_KEY: '' } });
    assert.equal((await noKey.json()).code, 'busy');
    const heic = await scanReceipt({ request: req('image/heic'), env: ENV });
    assert.equal((await heic.json()).code, 'busy');
    assert.equal(s.calls.claude.length, 0);
  } finally { s.restore(); }
});

test('a refusal from Claude is treated as no answer', async () => {
  const s = stub({ gemini: { error: 'quota' }, geminiStatus: 429, claude: claudeSaid(GOOD, 'refusal') });
  try {
    assert.equal((await (await scanReceipt({ request: req(), env: ENV })).json()).code, 'busy');
  } finally { s.restore(); }
});

test('jsonFrom pulls the object out of surrounding text', () => {
  assert.deepEqual(jsonFrom('Sure!\n{"a":1}\nThanks'), { a: 1 });
  assert.equal(jsonFrom('no json here'), null);
});
