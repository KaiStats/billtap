/**
 * Browser coverage for the guest-facing screens.
 *
 * The worker suites assert what the server computes. This asserts what a person
 * standing in a restaurant actually sees: that the scanned receipt reads as a
 * receipt, that the total on screen is the total they will be charged, that the
 * buttons do what their labels say.
 *
 * It drives the real built bundle in a real browser with the network stubbed at
 * the edge, so no Base44 app, no credentials and no OCR bill are involved. Run
 * it against dist/:
 *
 *     npm run build && npm run test:ui
 *
 * Named .browser.mjs rather than .test.mjs so the `npm test` glob cannot pick
 * it up: it needs Chromium and a built dist/, and CI has neither in the fast
 * lane. Run it with `npm run test:ui`.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const DIST = resolve(import.meta.dirname, '../dist');
const PHONE = { width: 390, height: 844 };
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/**
 * Console noise the harness causes rather than the app.
 *
 * The stubbed endpoints deliberately answer 401 and 500, and the Base44 SDK
 * opens a realtime socket that a static file server cannot speak. What must
 * never appear is a React error, a bad import or a null dereference.
 */
const IGNORED_CONSOLE =
  /favicon|manifest|net::ERR|Failed to load resource|WebSocket|socket\.io|websocket error|connect_error/i;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.ico': 'image/x-icon', '.txt': 'text/plain', '.xml': 'application/xml',
};

/** dist/ over HTTP with the SPA fallback the Worker's assets binding provides. */
function serveDist() {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = join(DIST, path);
    if (!existsSync(file) || path.endsWith('/')) file = join(DIST, 'index.html');
    try {
      const buf = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(buf);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((ok) => server.listen(0, () => ok({ server, port: server.address().port })));
}

// A one-pixel PNG, so the upload path gets a file the browser will decode.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** The receipt the stubbed scan returns. Prices chosen so the maths is checkable by hand. */
const SCAN = {
  title: 'Olive Garden',
  items: [
    { name: 'Chicken Alfredo', price: 19.95, quantity: 1 },
    { name: 'Lasagna Classico', price: 18.5, quantity: 1 },
    { name: 'Breadsticks', price: 4.5, quantity: 2 },
    { name: 'Iced Tea', price: 3.25, quantity: 3 },
  ],
  tax: 4.2,
  tip: 0,
  total: 61.4,
};
// 19.95 + 18.50 + 9.00 + 9.75 = 57.20 subtotal
const SUBTOTAL = 57.2;

let browser;
let base;
let httpServer;

before(async () => {
  assert.ok(existsSync(join(DIST, 'index.html')), 'run `npm run build` before the UI suite');
  const { server, port } = await serveDist();
  httpServer = server;
  base = `http://127.0.0.1:${port}`;
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  });
});

after(async () => {
  await browser?.close();
  httpServer?.close();
});

/**
 * A phone-sized page with every network call stubbed and console errors
 * collected, so a test can assert the screen came up clean.
 */
async function phone({ scan = SCAN, onCreate, hostSession = null, hostAllowed = true, uploadDelayMs = 0, scanDelayMs = 0, directScan = true } = {}) {
  const context = await browser.newContext({
    viewport: PHONE, deviceScaleFactor: 2, userAgent: IPHONE_UA, isMobile: true, hasTouch: true,
  });
  const errors = [];
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  const created = [];
  const confirmCalls = [];
  const settingsCalls = [];
  const qrCalls = [];
  const uploadCalls = [];
  const scanCalls = [];
  const statusCalls = [];
  // Every poll of any kind. The host screen reads through getSessionAsHost and
  // a diner through getSplitStatus, so a test that counts only one of them is
  // counting nothing on half the screens.
  const pollCalls = [];
  // The split the host screen reads back. Mutated by confirmPayment below so
  // the page behaves like the real thing across a confirm.
  let hostState = hostSession ? structuredClone(hostSession) : null;

  /**
   * Supabase Storage, which is where the receipt photo goes now.
   *
   * A separate route because it is a different origin and a path with no /api/
   * in it — the rule below never saw these requests, so six upload tests were
   * asserting against a network call that had silently stopped being made.
   *
   * The returned URL is no longer the server's to choose: uploadReceipt.js
   * derives it from the object key via getPublicUrl. So "which photo was used"
   * is answered by the key in the request path, and the tests read it there.
   */
  await page.route('**/storage/v1/object/**', async (route) => {
    uploadCalls.push({ at: Date.now(), url: route.request().url() });
    if (uploadDelayMs) await new Promise((r) => setTimeout(r, uploadDelayMs));
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ Key: new URL(route.request().url()).pathname.split('/object/').pop() }),
    });
  });

  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const send = (data) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });

    if (url.includes('/api/scan-receipt')) {
      scanCalls.push(Date.now());
      if (!directScan) {
        return route.fulfill({ status: 503, contentType: 'application/json', body: '{"code":"not_configured"}' });
      }
      if (scanDelayMs) await new Promise((r) => setTimeout(r, scanDelayMs));
      return send(scan);
    }
    if (url.includes('InvokeLLM')) return send(scan);
    // Still routed so that a call would be visible: a test asserts the scan
    // makes none, because the arithmetic moved into the browser.
    if (url.includes('/fn/validateReceiptParse')) {
      return route.fulfill({ status: 500, body: '{}' });
    }
    if (url.includes('/fn/createSession')) {
      const payload = route.request().postDataJSON();
      created.push(payload);
      if (onCreate) onCreate(payload);
      return send({ session: { id: 'sess_test_1', ...payload }, host_key: 'hk_test_secret_value' });
    }
    if (url.includes('/fn/generateQRSignature')) {
      const payload = route.request().postDataJSON();
      qrCalls.push(payload);
      if (!payload.host_key) {
        return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"Unauthorized"}' });
      }
      return send({ qr_token: 'sess_test_1.9999999999999.sig', expires_at: 9999999999999 });
    }
    if (url.includes('/fn/updateSplitSettings')) {
      const payload = route.request().postDataJSON();
      settingsCalls.push(payload);
      if (!payload.host_key) {
        return route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"Only the host can change this split"}' });
      }
      hostState = { ...hostState, ...(payload.host_payment_info ? { host_payment_info: payload.host_payment_info } : {}), ...(payload.status ? { status: payload.status } : {}) };
      return send({ session: hostState });
    }
    if (url.includes('/fn/getSplitStatus')) {
      const payload = route.request().postDataJSON();
      statusCalls.push({ ...payload, header: route.request().headers()['x-billtap-participant'] });
      pollCalls.push('guest');
      return send({ session: hostState });
    }
    if (url.includes('/fn/getSessionAsHost')) {
      pollCalls.push('host');
      const { host_key } = route.request().postDataJSON();
      if (!hostAllowed || !host_key) {
        return route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"Not the host of this split"}' });
      }
      return send({ session: hostState });
    }
    if (url.includes('/fn/confirmPayment')) {
      const payload = route.request().postDataJSON();
      confirmCalls.push(payload);
      hostState = {
        ...hostState,
        participants: hostState.participants.map((p) => {
          if (p.participant_id !== payload.participant_id) return p;
          return payload.action === 'undo'
            ? { ...p, payment_status: 'unpaid', paid_amount: undefined, paid_at: undefined }
            : { ...p, payment_status: 'paid', paid_amount: p.amount_owed, paid_at: 1 };
        }),
      };
      hostState.status = hostState.participants.every((p) => p.payment_status === 'paid') ? 'completed' : 'claiming';
      return send({ session: hostState });
    }
    if (url.includes('/entities/User/me') || url.includes('/auth/me')) {
      return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"anon"}' });
    }
    // The ordinary entity read a diner falls back to. Base44's rules answer
    // this with nothing unless they are a participant or the owner; the tests
    // that need "a diner can see the split but not act on it" get it here.
    if (url.includes('/entities/Session')) return send(hostState ? [hostState] : []);
    return send({});
  });

  return {
    context, page, errors, created, confirmCalls, settingsCalls, qrCalls, statusCalls, pollCalls, uploadCalls, scanCalls,
    host: () => hostState,
    /** Change the split behind the app's back, the way another phone would. */
    setHost: (next) => { hostState = next; },
  };
}

/** A split mid-service: one diner says they sent it, one has not moved. */
const HOST_SESSION = {
  id: 'sess_test_1',
  title: 'Olive Garden',
  split_mode: 'itemized',
  total_amount: 61.4,
  tax: 4.2,
  tip: 0,
  status: 'claiming',
  items: [
    { id: 'i1', name: 'Chicken Alfredo', price: 19.95, quantity: 1, claimed_by: ['p_1700000000000_aaa'] },
    { id: 'i2', name: 'Lasagna Classico', price: 41.45, quantity: 1, claimed_by: ['p_1700000000001_bbb'] },
  ],
  participants: [
    { participant_id: 'p_1700000000000_aaa', name: 'Alice', amount_owed: 21.4, payment_status: 'pending_verification' },
    { participant_id: 'p_1700000000001_bbb', name: 'Bob', amount_owed: 40, payment_status: 'unpaid' },
  ],
};

/** Opens the receipt screen with (or without) the host secret on the device. */
async function openReceipt(page, { withHostKey = true } = {}) {
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  if (withHostKey) {
    await page.evaluate(() => localStorage.setItem('billtap-hostkey-sess_test_1', 'hk_test_secret_value'));
  } else {
    await page.evaluate(() => localStorage.removeItem('billtap-hostkey-sess_test_1'));
  }
  await page.goto(`${base}/receipt-detail?id=sess_test_1`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Who owes what').waitFor({ timeout: 15000 });
}

/** Walks step 1 and lands on the review screen. */
async function toReview(page) {
  await page.goto(`${base}/new-receipt`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Upload receipt photo/i }).waitFor();
  await page.locator('#file-input').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: PNG_1PX });
  await page.getByRole('button', { name: /Parse Receipt with AI/i }).click();
  await page.getByRole('heading', { name: 'Olive Garden' }).or(page.getByLabel('Where were you?')).waitFor({ timeout: 15000 });
}

/** Every dollar figure on the screen, in order. */
const money = (page) => page.locator('body').innerText().then((t) => t.match(/\$[\d,]+\.\d{2}/g) || []);

/** The total in the receipt footer. */
async function totalOnScreen(page) {
  const t = await page.locator('text=/^\\$[\\d,]+\\.\\d{2}$/').last().innerText();
  return Number(t.replace(/[$,]/g, ''));
}

// ── The review screen opens simple ──────────────────────────────────────────

test('a scanned receipt lands on the review screen', async () => {
  const { context, page } = await phone();
  try {
    await toReview(page);
    await assert.doesNotReject(page.getByRole('heading', { name: 'Olive Garden' }).waitFor({ timeout: 5000 }));
  } finally { await context.close(); }
});

test('the review screen has no text boxes to fill in by default', async () => {
  const { context, page } = await phone();
  try {
    await toReview(page);
    assert.equal(await page.locator('input:visible').count(), 0,
      'the default path is "read it and continue", not "fill in this form"');
  } finally { await context.close(); }
});

test('every scanned item is on screen with its price', async () => {
  const { context, page } = await phone();
  try {
    await toReview(page);
    const text = await page.locator('body').innerText();
    for (const item of SCAN.items) assert.match(text, new RegExp(item.name));
    assert.match(text, /\$19\.95/);
    assert.match(text, /\$18\.50/);
  } finally { await context.close(); }
});

test('a quantity is shown as a multiplier and priced as a line, not a unit', async () => {
  const { context, page } = await phone();
  try {
    await toReview(page);
    const text = await page.locator('body').innerText();
    assert.match(text, /2×\s*Breadsticks/);
    assert.match(text, /\$9\.00/, '2 × $4.50');
    assert.match(text, /3×\s*Iced Tea/);
    assert.match(text, /\$9\.75/, '3 × $3.25');
  } finally { await context.close(); }
});

test('the item count is stated once, in words a diner reads', async () => {
  const { context, page } = await phone();
  try {
    await toReview(page);
    await assert.doesNotReject(page.getByText('4 items', { exact: true }).waitFor({ timeout: 3000 }));
  } finally { await context.close(); }
});

test('a clean scan gets no congratulatory banner', async () => {
  const { context, page } = await phone();
  try {
    await toReview(page);
    const text = await page.locator('body').innerText();
    assert.ok(!/fix anything that looks wrong/i.test(text));
    assert.ok(!/Found 4 items/i.test(text));
  } finally { await context.close(); }
});

test('the total on screen is the subtotal plus tax plus tip', async () => {
  const { context, page } = await phone();
  try {
    await toReview(page);
    assert.equal(await totalOnScreen(page), Number((SUBTOTAL + SCAN.tax).toFixed(2)));
  } finally { await context.close(); }
});

test('a zero tip is not printed as a $0.00 line', async () => {
  const { context, page } = await phone();
  try {
    await toReview(page);
    const rows = await page.locator('body').innerText();
    assert.ok(!/\$0\.00/.test(rows), 'nothing on this screen should read $0.00');
  } finally { await context.close(); }
});

test('tax is shown, because the diner is paying it', async () => {
  const { context, page } = await phone();
  try {
    await toReview(page);
    const text = await page.locator('body').innerText();
    assert.match(text, /Tax/);
    assert.match(text, /\$4\.20/);
  } finally { await context.close(); }
});

// ── Editing ─────────────────────────────────────────────────────────────────

test('"Change something" is what opens the editor', async () => {
  const { context, page } = await phone();
  try {
    await toReview(page);
    await page.getByRole('button', { name: /Change something/i }).click();
    const inputs = await page.locator('input:visible').count();
    assert.equal(inputs, 4 * 2 + 2, 'name and price per item, plus the title and tax');
  } finally { await context.close(); }
});

test('the editor closes again and the receipt comes back', async () => {
  const { context, page } = await phone();
  try {
    await toReview(page);
    await page.getByRole('button', { name: /Change something/i }).click();
    await page.getByRole('button', { name: /Looks good/i }).click();
    assert.equal(await page.locator('input:visible').count(), 0);
    await assert.doesNotReject(page.getByRole('heading', { name: 'Olive Garden' }).waitFor({ timeout: 3000 }));
  } finally { await context.close(); }
});

test('a corrected price is reflected in the total immediately', async () => {
  const { context, page } = await phone();
  try {
    await toReview(page);
    const before = await totalOnScreen(page);
    await page.getByRole('button', { name: /Change something/i }).click();
    await page.getByLabel('Item 1 price').fill('29.95');
    assert.equal(await totalOnScreen(page), Number((before + 10).toFixed(2)));
  } finally { await context.close(); }
});

test('the price field shows the cents in full, even on a three-figure entrée', async () => {
  const { context, page } = await phone();
  try {
    await toReview(page);
    await page.getByRole('button', { name: /Change something/i }).click();
    const field = page.getByLabel('Item 1 price');

    // index.css pads every number input 16px a side, and the root font is
    // fluid, so the box is a good deal narrower than its w-* class suggests.
    // $129.95 is an ordinary steakhouse line; if that does not fit, someone is
    // reading a price that is not the price.
    await field.fill('129.95');
    const fits = await field.evaluate((n) => n.scrollWidth <= n.clientWidth);
    assert.equal(fits, true, '129.95 is being clipped — the field is too narrow');
  } finally { await context.close(); }
});

test('removing an item drops it from the receipt and from the total', async () => {
  const { context, page } = await phone();
  try {
    await toReview(page);
    const before = await totalOnScreen(page);
    await page.getByRole('button', { name: /Change something/i }).click();
    await page.getByRole('button', { name: /Remove Chicken Alfredo/i }).click();
    await page.getByRole('button', { name: /Looks good/i }).click();
    await page.getByText('3 items', { exact: true }).waitFor();
    assert.equal(await totalOnScreen(page), Number((before - 19.95).toFixed(2)));
    assert.ok(!(await page.locator('body').innerText()).includes('Chicken Alfredo'));
  } finally { await context.close(); }
});

test('an item the scan missed can be added by hand', async () => {
  const { context, page } = await phone();
  try {
    await toReview(page);
    await page.getByRole('button', { name: /Change something/i }).click();
    await page.getByRole('button', { name: /Add an item/i }).click();
    await page.getByLabel('Item 5 name').fill('Tiramisu');
    await page.getByLabel('Item 5 price').fill('8.95');
    await page.getByRole('button', { name: /Looks good/i }).click();
    const text = await page.locator('body').innerText();
    assert.match(text, /Tiramisu/);
    assert.match(text, /\$8\.95/);
  } finally { await context.close(); }
});

test('the restaurant name can be corrected, with suggestions', async () => {
  const { context, page } = await phone();
  try {
    await toReview(page);
    await page.getByRole('button', { name: /Change something/i }).click();
    await page.getByLabel('Where were you?').fill('Chip');
    await page.getByRole('button', { name: 'Chipotle', exact: true }).click();
    await page.getByRole('button', { name: /Looks good/i }).click();
    await assert.doesNotReject(page.getByRole('heading', { name: 'Chipotle' }).waitFor({ timeout: 3000 }));
  } finally { await context.close(); }
});

// ── When the scan is not trustworthy ────────────────────────────────────────

test('a low-confidence scan opens the editor by itself and says why', async () => {
  // Driven by the scan itself now, not by a stubbed verdict: the arithmetic
  // runs in the browser, so a receipt whose numbers do not reconcile is the
  // actual input. $57.20 of items and $4.20 tax against a printed $75.00.
  const { context, page } = await phone({ scan: { ...SCAN, total: 75 } });
  try {
    await toReview(page);
    assert.ok(await page.locator('input:visible').count() > 0, 'editing is already open');
    const text = await page.locator('body').innerText();
    assert.match(text, /hard to read/i);
    assert.match(text, /61\.40/, 'what the items actually come to');
    assert.match(text, /75\.00/, 'what the receipt claims');
  } finally { await context.close(); }
});

test('a middling scan asks for a look without opening the editor', async () => {
  // The totals reconcile, but one item came back with no name — worth a glance,
  // not worth forcing nineteen fields open.
  const items = [...SCAN.items, { name: '', price: 0, quantity: 1 }];
  const { context, page } = await phone({ scan: { ...SCAN, items } });
  try {
    await toReview(page);
    assert.equal(await page.locator('input:visible').count(), 0);
    assert.match(await page.locator('body').innerText(), /quick look/i);
  } finally { await context.close(); }
});

test('a scan that found nothing opens the editor rather than an empty receipt', async () => {
  const { context, page } = await phone({ scan: { ...SCAN, items: [], tax: 0, tip: 0, total: 0 } });
  try {
    await toReview(page);
    assert.ok(await page.locator('input:visible').count() > 0);
  } finally { await context.close(); }
});

test('the arithmetic check cannot cost the diner their scan', async () => {
  // It used to be a server call awaited before anything was shown, so a failure
  // there discarded a perfectly good parse. It now runs in the browser, which
  // removes the failure mode rather than handling it — the endpoint is still
  // stubbed to 500 here to prove nothing depends on it.
  const { context, page } = await phone();
  try {
    await toReview(page);
    assert.match(await page.locator('body').innerText(), /Chicken Alfredo/);
  } finally { await context.close(); }
});

// ── Tip and split method ────────────────────────────────────────────────────

test('a tip preset adds the right amount to the total', async () => {
  const { context, page } = await phone();
  try {
    await toReview(page);
    const before = await totalOnScreen(page);
    await page.getByRole('button', { name: 'Tip 20%' }).click();
    const expected = Number((before + SUBTOTAL * 0.2).toFixed(2));
    assert.equal(await totalOnScreen(page), expected);
    assert.match(await page.locator('body').innerText(), /Tip/);
  } finally { await context.close(); }
});

test('the tip is a percentage of the food, not of the food plus tax', async () => {
  const { context, page } = await phone();
  try {
    await toReview(page);
    await page.getByRole('button', { name: 'Tip 20%' }).click();
    const text = await page.locator('body').innerText();
    assert.match(text, /\$11\.44/, '20% of the $57.20 subtotal');
  } finally { await context.close(); }
});

test('"No tip" is selectable and leaves the total at the bill', async () => {
  const { context, page } = await phone();
  try {
    await toReview(page);
    await page.getByRole('button', { name: 'Tip 20%' }).click();
    await page.getByRole('button', { name: 'No tip' }).click();
    assert.equal(await totalOnScreen(page), Number((SUBTOTAL + SCAN.tax).toFixed(2)));
  } finally { await context.close(); }
});

test('a custom tip amount can be typed in', async () => {
  const { context, page } = await phone();
  try {
    await toReview(page);
    const before = await totalOnScreen(page);
    await page.getByRole('button', { name: /Type a different amount/i }).click();
    await page.getByLabel(/Custom tip amount/i).fill('7');
    assert.equal(await totalOnScreen(page), Number((before + 7).toFixed(2)));
  } finally { await context.close(); }
});

test('itemized is the split method offered first, and it explains itself', async () => {
  const { context, page } = await phone();
  try {
    await toReview(page);
    const chosen = page.getByRole('button', { name: /Everyone picks what they ate/i });
    assert.equal(await chosen.getAttribute('aria-pressed'), 'true');
    assert.match(await page.locator('body').innerText(), /Tax and tip get split fairly/);
  } finally { await context.close(); }
});

test('exactly one split method is ever selected', async () => {
  const { context, page } = await phone();
  try {
    await toReview(page);
    await page.getByRole('button', { name: /Split it evenly/i }).click();
    assert.equal(await page.locator('button[aria-pressed="true"]').filter({ hasText: /picks what they ate|evenly|decide who pays/ }).count(), 1);
    assert.match(await page.locator('body').innerText(), /Everyone pays the same amount/);
  } finally { await context.close(); }
});

// ── Getting the code ────────────────────────────────────────────────────────

test('the button says what it produces', async () => {
  const { context, page } = await phone();
  try {
    await toReview(page);
    await assert.doesNotReject(page.getByRole('button', { name: /Show the QR code/i }).waitFor({ timeout: 3000 }));
    assert.match(await page.locator('body').innerText(), /no app, no sign-up/i);
  } finally { await context.close(); }
});

test('an itemized split with no items cannot be shared', async () => {
  const { context, page } = await phone({ scan: { ...SCAN, items: [], tax: 0, tip: 0, total: 0 } });
  try {
    await toReview(page);
    assert.equal(await page.getByRole('button', { name: /Show the QR code/i }).isDisabled(), true);
  } finally { await context.close(); }
});

test('creating the split sends the server what is on the screen', async () => {
  const { context, page, created } = await phone();
  try {
    await toReview(page);
    await page.getByRole('button', { name: 'Tip 20%' }).click();
    await page.getByRole('button', { name: /Show the QR code/i }).click();
    await page.waitForURL(/session-host\?id=sess_test_1/, { timeout: 10000 });

    const sent = created[0];
    assert.equal(sent.title, 'Olive Garden');
    assert.equal(sent.items.length, 4);
    assert.equal(sent.tax, 4.2);
    assert.equal(sent.split_mode, 'itemized');
    assert.equal(Number(sent.tip.toFixed(2)), 11.44);
    assert.equal(Number(sent.total_amount.toFixed(2)), Number((SUBTOTAL + 4.2 + 11.44).toFixed(2)));
  } finally { await context.close(); }
});

test('a guest is taken to the host screen, not bounced to a login', async () => {
  // The destination changed with the host key: whoever just made the split is
  // the host, and the button they pressed said "Show the QR code". It used to
  // ask Base44 whether they were signed in and drop a guest on the diner's
  // screen, which has no QR on it.
  const { context, page } = await phone({ hostSession: HOST_SESSION });
  try {
    await toReview(page);
    await page.getByRole('button', { name: /Show the QR code/i }).click();
    await page.waitForURL(/\/session-host\?id=/, { timeout: 10000 });
    assert.ok(!page.url().includes('/login'), 'a diner with no account must never see a login wall');
  } finally { await context.close(); }
});

// ── The screen itself ───────────────────────────────────────────────────────

test('the review screen fits a phone with nothing spilling sideways', async () => {
  const { context, page } = await phone();
  try {
    await toReview(page);
    for (const width of [360, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 1, `${width}px overflowed by ${overflow}px`);
    }
  } finally { await context.close(); }
});

test('the receipt is readable — real contrast, not near-black on black', async () => {
  const { context, page } = await phone();
  try {
    await toReview(page);
    const contrast = await page.getByRole('heading', { name: 'Olive Garden' }).evaluate((el) => {
      const parse = (c) => {
        const n = (c.match(/[\d.]+/g) || [0, 0, 0]).map(Number);
        return { r: n[0], g: n[1], b: n[2], a: n[3] ?? 1 };
      };
      // The cards are rgba(255,255,255,0.03) over dark chrome. Reading that as
      // white is how a contrast check reports 1.04:1 on a page that is actually
      // fine — so composite the translucent layers down to an opaque colour.
      const flatten = (node) => {
        const stack = [];
        for (let n = node; n; n = n.parentElement) {
          const c = parse(getComputedStyle(n).backgroundColor);
          if (c.a > 0) stack.push(c);
          if (c.a === 1) break;
        }
        let out = stack.pop() || { r: 255, g: 255, b: 255, a: 1 };
        while (stack.length) {
          const top = stack.pop();
          out = {
            r: top.r * top.a + out.r * (1 - top.a),
            g: top.g * top.a + out.g * (1 - top.a),
            b: top.b * top.a + out.b * (1 - top.a),
            a: 1,
          };
        }
        return out;
      };
      const lum = ({ r, g, b }) => {
        const [R, G, B] = [r, g, b].map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * R + 0.7152 * G + 0.0722 * B;
      };
      const bg = flatten(el);
      const fg = parse(getComputedStyle(el).color);
      const text = fg.a === 1 ? fg : {
        r: fg.r * fg.a + bg.r * (1 - fg.a),
        g: fg.g * fg.a + bg.g * (1 - fg.a),
        b: fg.b * fg.a + bg.b * (1 - fg.a),
      };
      const a = lum(text), b = lum(bg);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
    assert.ok(contrast >= 4.5, `contrast was ${contrast.toFixed(2)}:1, below the 4.5:1 floor`);
  } finally { await context.close(); }
});

test('every interactive control on the review screen is thumb-sized', async () => {
  const { context, page } = await phone();
  try {
    await toReview(page);
    const small = await page.locator('button:visible').evaluateAll((els) =>
      els
        .map((e) => ({ label: (e.innerText || e.ariaLabel || '').slice(0, 30), h: e.getBoundingClientRect().height }))
        .filter((b) => b.h > 0 && b.h < 44));
    assert.deepEqual(small, [], 'controls under 44px are hard to hit while holding a phone');
  } finally { await context.close(); }
});

test('the review screen renders without a single console error', async () => {
  const { context, page, errors } = await phone();
  try {
    await toReview(page);
    await page.getByRole('button', { name: /Change something/i }).click();
    await page.getByRole('button', { name: 'Tip 18%' }).click();
    // The stubbed auth check answers 401 and validateReceiptParse answers 500 on
    // purpose; the browser logs those itself. What must not appear is a React
    // error, a bad import or a null dereference.
    const real = errors.filter((e) => !IGNORED_CONSOLE.test(e));
    assert.deepEqual(real, []);
  } finally { await context.close(); }
});

// ── A guest host, from photograph to QR code ────────────────────────────────
//
// The journey the product is sold on, walked by someone with no account: scan
// the receipt at a restaurant table, get a code the table can scan. Every step
// of this used to end at a login wall or on a screen with no QR on it.

async function toHostScreen(page) {
  await toReview(page);
  await page.getByRole('button', { name: /Show the QR code/i }).click();
  await page.waitForURL(/\/session-host\?id=/, { timeout: 15000 });
  // The screen returns a spinner until the split loads; everything below it
  // only exists once it has.
  await page.getByRole('button', { name: /Claim My Items|View Progress/i }).waitFor({ timeout: 15000 });
}

test('a guest with no account reaches the QR screen after scanning', async () => {
  const { context, page } = await phone({ hostSession: HOST_SESSION });
  try {
    await toHostScreen(page);
    assert.ok(!page.url().includes('/login'), 'no account, no login wall');
  } finally { await context.close(); }
});

test('the button that says "Show the QR code" actually shows a QR code', async () => {
  const { context, page } = await phone({ hostSession: HOST_SESSION });
  try {
    await toHostScreen(page);
    await page.waitForTimeout(1500);
    const qr = await page.evaluate(() => {
      const square = [...document.querySelectorAll('svg')].find((s) => {
        const r = s.getBoundingClientRect();
        return r.width > 120 && Math.abs(r.width - r.height) < 4;
      });
      return square ? square.getBoundingClientRect().width : 0;
    });
    assert.ok(qr > 120, `expected a scannable QR, measured ${qr}px`);
  } finally { await context.close(); }
});

test('the QR is minted with the host key rather than an account', async () => {
  const { context, page, qrCalls } = await phone({ hostSession: HOST_SESSION });
  try {
    await toHostScreen(page);
    await page.waitForTimeout(800);
    assert.ok(qrCalls.length > 0, 'the host screen asked for a token');
    assert.equal(qrCalls[0].host_key, 'hk_test_secret_value',
      'without the key this endpoint answers 401 and the guest host gets no QR');
  } finally { await context.close(); }
});

test('a guest host can set where the table should send the money', async () => {
  const { context, page, settingsCalls } = await phone({ hostSession: HOST_SESSION });
  try {
    await toHostScreen(page);
    await page.getByRole('button', { name: /Claim My Items|View Progress/i }).click();
    await page.getByRole('button', { name: 'Venmo', exact: true }).click();
    await page.getByPlaceholder('e.g. @yourname').fill('@kai');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.waitForTimeout(600);

    const call = settingsCalls.find((c) => c.host_payment_info);
    assert.ok(call, 'without this nobody at the table has anywhere to send money');
    assert.equal(call.host_key, 'hk_test_secret_value');
    assert.deepEqual(call.host_payment_info, { method: 'venmo', handle: '@kai' });
  } finally { await context.close(); }
});

test('the host screen fits a phone', async () => {
  const { context, page } = await phone({ hostSession: HOST_SESSION });
  try {
    await toHostScreen(page);
    await page.waitForTimeout(1200);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, `overflowed by ${overflow}px`);
  } finally { await context.close(); }
});

// ── Confirming that the money arrived ───────────────────────────────────────

test('creating a split leaves the host secret on the device that made it', async () => {
  const { context, page } = await phone();
  try {
    await toReview(page);
    await page.getByRole('button', { name: /Show the QR code/i }).click();
    await page.waitForURL(/\/session-host\?id=/, { timeout: 10000 });
    const stored = await page.evaluate(() => localStorage.getItem('billtap-hostkey-sess_test_1'));
    assert.equal(stored, 'hk_test_secret_value', 'without this the host can never confirm a payment');
  } finally { await context.close(); }
});

test('the host sees a confirm button naming the person and the amount', async () => {
  const { context, page } = await phone({ hostSession: HOST_SESSION });
  try {
    await openReceipt(page);
    await assert.doesNotReject(page.getByRole('button', { name: /Got \$21\.40 from Alice/i }).waitFor({ timeout: 5000 }));
    await assert.doesNotReject(page.getByRole('button', { name: /Got \$40\.00 from Bob/i }).waitFor({ timeout: 5000 }));
  } finally { await context.close(); }
});

test('a diner without the host secret sees the split but gets no confirm buttons', async () => {
  const { context, page } = await phone({ hostSession: HOST_SESSION, hostAllowed: false });
  try {
    await openReceipt(page, { withHostKey: false });
    assert.match(await page.locator('body').innerText(), /Alice/, 'they can still read their own receipt');
    assert.equal(await page.getByRole('button', { name: /Got \$/i }).count(), 0,
      'appending ?host=1 to the URL used to be enough to make these appear');
    assert.equal(await page.getByRole('button', { name: /Undo/i }).count(), 0);
  } finally { await context.close(); }
});

test('confirming sends the host key and the one participant, never the whole table', async () => {
  const { context, page, confirmCalls } = await phone({ hostSession: HOST_SESSION });
  try {
    await openReceipt(page);
    await page.getByRole('button', { name: /Got \$21\.40 from Alice/i }).click();
    await page.getByRole('button', { name: /Undo/i }).first().waitFor({ timeout: 5000 });

    assert.equal(confirmCalls.length, 1);
    assert.deepEqual(confirmCalls[0], {
      session_id: 'sess_test_1',
      participant_id: 'p_1700000000000_aaa',
      host_key: 'hk_test_secret_value',
      action: 'confirm',
    });
    assert.ok(!('participants' in confirmCalls[0]), 'the browser does not get to rewrite the participants array');
  } finally { await context.close(); }
});

test('a confirmed diner turns into an undo, and the tally moves', async () => {
  const { context, page } = await phone({ hostSession: HOST_SESSION });
  try {
    await openReceipt(page);
    assert.match(await page.locator('body').innerText(), /0\/2 confirmed/);

    await page.getByRole('button', { name: /Got \$21\.40 from Alice/i }).click();
    await page.getByText('1/2 confirmed').waitFor({ timeout: 5000 });
    assert.match(await page.locator('body').innerText(), /You confirmed it/);
  } finally { await context.close(); }
});

test('the host can take a confirmation back', async () => {
  const { context, page, confirmCalls } = await phone({ hostSession: HOST_SESSION });
  try {
    await openReceipt(page);
    await page.getByRole('button', { name: /Got \$21\.40 from Alice/i }).click();
    await page.getByRole('button', { name: /Undo/i }).first().click();
    await page.getByRole('button', { name: /Got \$21\.40 from Alice/i }).waitFor({ timeout: 5000 });
    assert.equal(confirmCalls.at(-1).action, 'undo');
  } finally { await context.close(); }
});

test('"says they sent it" and "you confirmed it" are told apart in words', async () => {
  const { context, page } = await phone({ hostSession: HOST_SESSION });
  try {
    await openReceipt(page);
    const text = await page.locator('body').innerText();
    assert.match(text, /Says they sent it/, 'Alice tapped the button');
    assert.match(text, /Not paid yet/, 'Bob has not');
    assert.ok(!/pending_verification/.test(text), 'a host should never be shown a schema enum');
  } finally { await context.close(); }
});

test('the tally counts confirmations, and says how many still need checking', async () => {
  const { context, page } = await phone({ hostSession: HOST_SESSION });
  try {
    await openReceipt(page);
    const text = await page.locator('body').innerText();
    assert.match(text, /0\/2 confirmed/, 'nobody is confirmed yet, however many have tapped');
    assert.match(text, /1 waiting on you/);
  } finally { await context.close(); }
});

test('the host sees money collected against the bill, not just a headcount', async () => {
  const { context, page } = await phone({ hostSession: HOST_SESSION });
  try {
    await openReceipt(page);
    assert.match(await page.locator('body').innerText(), /\$0\.00 of \$61\.40 collected/);
    await page.getByRole('button', { name: /Got \$21\.40 from Alice/i }).click();
    await page.getByText(/\$21\.40 of \$61\.40 collected/).waitFor({ timeout: 5000 });
  } finally { await context.close(); }
});

test('everyone ticked off and the bill covered is a celebration', async () => {
  const { context, page } = await phone({ hostSession: HOST_SESSION });
  try {
    await openReceipt(page);
    await page.getByRole('button', { name: /Got \$21\.40 from Alice/i }).click();
    await page.getByRole('button', { name: /Got \$40\.00 from Bob/i }).click();
    await page.getByText(/All Settled/i).waitFor({ timeout: 5000 });
    assert.match(await page.locator('body').innerText(), /\$61\.40 of \$61\.40 collected/);
  } finally { await context.close(); }
});

test('everyone ticked off but the bill short is not a celebration', async () => {
  // Alice was confirmed at $21.40 and then claimed another $10 of food, so her
  // share is $31.40 while what she actually handed over stays at $21.40. Every
  // row is ticked and the bill is still $10 light — the one case where a
  // headcount lies and only the money tells the truth.
  const short = structuredClone(HOST_SESSION);
  short.total_amount = 71.4;
  short.participants[0] = {
    ...short.participants[0],
    amount_owed: 31.4, payment_status: 'paid', paid_amount: 21.4, paid_at: 1,
  };
  const { context, page } = await phone({ hostSession: short });
  try {
    await openReceipt(page);
    assert.match(await page.locator('body').innerText(), /Claimed \$10\.00 more after paying/);

    await page.getByRole('button', { name: /Got \$40\.00 from Bob/i }).click();
    await page.getByText(/of the bill is still uncovered/i).waitFor({ timeout: 5000 });
    assert.ok(!(await page.locator('body').innerText()).includes('All Settled'));
  } finally { await context.close(); }
});

test('the receipt screen renders without console errors for the host', async () => {
  const { context, page, errors } = await phone({ hostSession: HOST_SESSION });
  try {
    await openReceipt(page);
    await page.getByRole('button', { name: /Got \$21\.40 from Alice/i }).click();
    await page.getByText('1/2 confirmed').waitFor({ timeout: 5000 });
    const real = errors.filter((e) => !IGNORED_CONSOLE.test(e));
    assert.deepEqual(real, []);
  } finally { await context.close(); }
});

test('the confirm controls are thumb-sized and the screen fits a phone', async () => {
  const { context, page } = await phone({ hostSession: HOST_SESSION });
  try {
    await openReceipt(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, `overflowed by ${overflow}px`);
    const small = await page.locator('button:visible').evaluateAll((els) =>
      els.map((e) => ({ label: (e.innerText || e.ariaLabel || '').slice(0, 30), h: e.getBoundingClientRect().height }))
        .filter((b) => b.h > 0 && b.h < 44));
    assert.deepEqual(small, []);
  } finally { await context.close(); }
});

// ── The rest of the app still boots ─────────────────────────────────────────

for (const route of ['/', '/restaurants', '/about', '/blog', '/changelog', '/privacy', '/terms', '/new-receipt', '/login']) {
  test(`${route} renders on a phone without errors or sideways scroll`, async () => {
    const { context, page, errors } = await phone();
    try {
      await page.goto(`${base}${route}`, { waitUntil: 'networkidle' });
      const rootText = await page.locator('#root').innerText();
      assert.ok(rootText.trim().length > 0, 'the page painted something');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 1, `overflowed by ${overflow}px`);
      const real = errors.filter((e) => !IGNORED_CONSOLE.test(e));
      assert.deepEqual(real, []);
    } finally { await context.close(); }
  });
}

// ── The table updating itself ───────────────────────────────────────────────
//
// The moment the product is sold on: as each person settles up, a tick appears
// on every other screen with nobody refreshing anything. This used to be a
// Session.subscribe() that could not fire for a guest, so the ticks only ever
// showed what was true when the page loaded.

test('a payment landing elsewhere appears on the host screen by itself', async () => {
  const { context, page, host, setHost } = await phone({ hostSession: HOST_SESSION });
  try {
    await openReceipt(page);
    assert.match(await page.locator('body').innerText(), /0\/2 confirmed/);

    // Another device confirms Alice. Nothing is clicked here.
    const next = structuredClone(host());
    next.participants[0] = { ...next.participants[0], payment_status: 'paid', paid_amount: 21.4, paid_at: 1 };
    setHost(next);

    await page.getByText('1/2 confirmed').waitFor({ timeout: 15000 });
    assert.match(await page.locator('body').innerText(), /\$21\.40 of \$61\.40 collected/);
  } finally { await context.close(); }
});

test('a diner arriving shows up on the host screen without a refresh', async () => {
  const { context, page, host, setHost } = await phone({ hostSession: HOST_SESSION });
  try {
    await openReceipt(page);
    const next = structuredClone(host());
    next.participants.push({
      participant_id: 'p_1700000000002_ccc', name: 'Priya', amount_owed: 0, payment_status: 'unpaid',
    });
    setHost(next);

    await page.getByText('Priya').first().waitFor({ timeout: 15000 });
    assert.match(await page.locator('body').innerText(), /0\/3 confirmed/);
  } finally { await context.close(); }
});

test('polling stops once the split is finished', async () => {
  const done = structuredClone(HOST_SESSION);
  done.status = 'completed';
  done.participants = done.participants.map((p) => ({ ...p, payment_status: 'paid', paid_amount: p.amount_owed }));

  const { context, page, pollCalls } = await phone({ hostSession: done });
  try {
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => localStorage.setItem('billtap-hostkey-sess_test_1', 'hk_test_secret_value'));
    await page.goto(`${base}/receipt-detail?id=sess_test_1`, { waitUntil: 'domcontentloaded' });
    await page.getByText('Who owes what').waitFor({ timeout: 15000 });

    await page.waitForTimeout(6000);
    const settled = pollCalls.length;
    await page.waitForTimeout(8000);
    assert.equal(pollCalls.length, settled, 'a finished split has nothing left to watch');
  } finally { await context.close(); }
});

test('a phone in a pocket does not poll', async () => {
  const { context, page, pollCalls } = await phone({ hostSession: HOST_SESSION });
  try {
    // Report the tab as hidden from the very first paint, the way a locked
    // phone would. Most of a meal is spent like this.
    await page.addInitScript(() => {
      Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true });
      Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
    });
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => localStorage.setItem('billtap-hostkey-sess_test_1', 'hk_test_secret_value'));
    await page.goto(`${base}/receipt-detail?id=sess_test_1`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);

    assert.ok(pollCalls.length <= 1,
      `a hidden tab made ${pollCalls.length} polls; a table of six would be paying for all of them`);
  } finally { await context.close(); }
});

test('every poll says which diner it is for, so one table is not one bucket', async () => {
  const { context, page, statusCalls } = await phone({ hostSession: HOST_SESSION, hostAllowed: false });
  try {
    await page.goto(`${base}/claim?id=sess_test_1`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);

    assert.ok(statusCalls.length > 0, 'the claim screen polls');
    const withParticipant = statusCalls.filter((c) => c.participant_id);
    assert.ok(withParticipant.length > 0, 'the poll is scoped to a diner');
    assert.equal(withParticipant[0].header, withParticipant[0].participant_id,
      'the rate-limit header rides along, or six diners on one wifi share one allowance');
  } finally { await context.close(); }
});

test('taking the phone back out of a pocket reads the split at once', async () => {
  // The likeliest moment for something to have changed is the moment you look
  // again, so this must not wait out the interval — the tick a diner is waiting
  // for should already be there when the screen lights up.
  const { context, page, pollCalls, host, setHost } = await phone({ hostSession: HOST_SESSION });
  try {
    await page.addInitScript(() => {
      window.__hidden = true;
      Object.defineProperty(document, 'visibilityState', {
        get: () => (window.__hidden ? 'hidden' : 'visible'), configurable: true,
      });
      Object.defineProperty(document, 'hidden', { get: () => window.__hidden, configurable: true });
    });
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => localStorage.setItem('billtap-hostkey-sess_test_1', 'hk_test_secret_value'));
    await page.goto(`${base}/receipt-detail?id=sess_test_1`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);

    const whileAway = pollCalls.length;

    // Someone paid while the phone was face-down on the table.
    const next = structuredClone(host());
    next.participants[0] = { ...next.participants[0], payment_status: 'paid', paid_amount: 21.4, paid_at: 1 };
    setHost(next);

    await page.evaluate(() => {
      window.__hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Well inside FAST_MS, so this can only pass if the visibility handler read
    // straight away rather than the next scheduled tick happening to land.
    await page.getByText('1/2 confirmed').waitFor({ timeout: 1200 });
    assert.ok(pollCalls.length > whileAway, 'coming back should read, not wait');
  } finally { await context.close(); }
});

// ── A bill history for someone with no account ──────────────────────────────
//
// "Bill History — every split you've been in" is on the landing page. For a
// guest host, the person this product is built for, /dashboard used to answer
// by replacing the page with the landing page.

test('a guest with no account can see the splits from their phone', async () => {
  const { context, page } = await phone({ hostSession: HOST_SESSION });
  try {
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.setItem('billtap-hostkey-sess_test_1', 'hk_test_secret_value');
      localStorage.setItem('billtap-split-history', JSON.stringify([
        { id: 'sess_test_1', title: 'Olive Garden', total: 61.4, status: 'claiming',
          role: 'host', participants: 2, paid: 1, created_at: Date.now() },
      ]));
    });
    await page.goto(`${base}/dashboard`, { waitUntil: 'domcontentloaded' });

    await page.getByText('Olive Garden').first().waitFor({ timeout: 15000 });
    assert.ok(!page.url().includes('/login'));
    const text = await page.locator('body').innerText();
    assert.match(text, /Splits from this phone/);
    assert.match(text, /\$61\.40/);
  } finally { await context.close(); }
});

test('the history is drawn from the cache before the network answers', async () => {
  // A list that waits on N round-trips before painting is a list that looks
  // broken on a restaurant's wifi.
  const { context, page } = await phone({ hostSession: HOST_SESSION });
  try {
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.setItem('billtap-split-history', JSON.stringify([
        { id: 'sess_test_1', title: 'Cached Diner', total: 42, status: 'claiming',
          participants: 3, paid: 2, created_at: Date.now() },
      ]));
    });
    // Every read hangs, so anything on screen came from the cache.
    await page.route('**/fn/getSplitStatus', () => {});
    await page.route('**/fn/getSessionAsHost', () => {});
    await page.goto(`${base}/dashboard`, { waitUntil: 'domcontentloaded' });

    await page.getByText('Cached Diner').waitFor({ timeout: 10000 });
    assert.match(await page.locator('body').innerText(), /2\/3 paid/);
  } finally { await context.close(); }
});

test('the cached summary is replaced by what the server actually says', async () => {
  const { context, page } = await phone({ hostSession: HOST_SESSION });
  try {
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.setItem('billtap-hostkey-sess_test_1', 'hk_test_secret_value');
      localStorage.setItem('billtap-split-history', JSON.stringify([
        { id: 'sess_test_1', title: 'Stale Title', total: 1, status: 'claiming',
          role: 'host', participants: 0, paid: 0, created_at: Date.now() },
      ]));
    });
    await page.goto(`${base}/dashboard`, { waitUntil: 'domcontentloaded' });

    await page.getByText('Olive Garden').first().waitFor({ timeout: 15000 });
    assert.match(await page.locator('body').innerText(), /\$61\.40/);
  } finally { await context.close(); }
});

test('a split whose row is gone leaves the cached entry in place', async () => {
  const { context, page } = await phone({ hostSession: null });
  try {
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.setItem('billtap-split-history', JSON.stringify([
        { id: 'ghost', title: 'Last Tuesday', total: 20, status: 'completed',
          participants: 2, paid: 2, created_at: Date.now() },
      ]));
    });
    await page.route('**/fn/getSplitStatus', (r) =>
      r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"Session not found"}' }));
    await page.goto(`${base}/dashboard`, { waitUntil: 'domcontentloaded' });

    await page.getByText('Last Tuesday').waitFor({ timeout: 10000 });
    assert.match(await page.locator('body').innerText(), /Last Tuesday/,
      'one bad read must not empty somebody history');
  } finally { await context.close(); }
});

test('the history opens the host screen for a split you hosted', async () => {
  const { context, page } = await phone({ hostSession: HOST_SESSION });
  try {
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.setItem('billtap-hostkey-sess_test_1', 'hk_test_secret_value');
      localStorage.setItem('billtap-split-history', JSON.stringify([
        { id: 'sess_test_1', title: 'Olive Garden', total: 61.4, role: 'host',
          participants: 2, paid: 0, created_at: Date.now() },
      ]));
    });
    await page.goto(`${base}/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.getByText('Olive Garden').first().waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: /Olive Garden/i }).first().click();

    await page.waitForURL(/receipt-detail\?id=sess_test_1/, { timeout: 10000 });
    assert.ok(!page.url().includes('host=1'), 'that flag stopped meaning anything when the host key landed');
  } finally { await context.close(); }
});

test('the history opens the claim screen for a split you only ate at', async () => {
  const { context, page } = await phone({ hostSession: HOST_SESSION, hostAllowed: false });
  try {
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.removeItem('billtap-hostkey-sess_test_1');
      localStorage.setItem('billtap-split-history', JSON.stringify([
        { id: 'sess_test_1', title: 'Olive Garden', total: 61.4, role: 'guest',
          participants: 2, paid: 0, created_at: Date.now() },
      ]));
    });
    await page.goto(`${base}/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.getByText('Olive Garden').first().waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: /Olive Garden/i }).first().click();

    await page.waitForURL(/\/claim\?id=sess_test_1/, { timeout: 10000 });
  } finally { await context.close(); }
});

test('a guest sees what they owe, not a column they cannot read', async () => {
  // The scoped read withholds everyone else's amount_owed, so summing every
  // participant would show a diner $0.00 owed on a bill they have not paid.
  const owing = structuredClone(HOST_SESSION);
  owing.participants = [
    { participant_id: 'p_1700000000000_aaa', name: 'Alice', payment_status: 'paid' },
    { participant_id: 'p_1700000000009_zzz', name: 'You', amount_owed: 23.5, payment_status: 'unpaid' },
  ];
  const { context, page } = await phone({ hostSession: owing, hostAllowed: false });
  try {
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.setItem('billtap_participant_id', 'p_1700000000009_zzz');
      localStorage.setItem('billtap-split-history', JSON.stringify([
        { id: 'sess_test_1', title: 'Olive Garden', total: 61.4, role: 'guest',
          participants: 2, paid: 1, created_at: Date.now() },
      ]));
    });
    await page.goto(`${base}/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.getByText('You owe').waitFor({ timeout: 15000 });
    await page.getByText('$23.50').first().waitFor({ timeout: 10000 });
  } finally { await context.close(); }
});

test('a phone with no history is invited to split its first bill', async () => {
  const { context, page } = await phone({ hostSession: null });
  try {
    await page.goto(`${base}/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.getByText(/No bills yet/i).waitFor({ timeout: 15000 });
    assert.ok(!page.url().includes('/login'));
  } finally { await context.close(); }
});

// ── Forgetting a password ───────────────────────────────────────────────────
//
// Login.jsx has linked to /forgot-password since it was written and the page
// never existed, so the whole recovery path ended at a 404.

async function authPage(path) {
  const context = await browser.newContext({
    viewport: PHONE, deviceScaleFactor: 2, userAgent: IPHONE_UA, isMobile: true, hasTouch: true,
  });
  const errors = [];
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  const authCalls = [];
  // Supabase auth lives on another origin, so this cannot be scoped to /api/.
  await page.route('**/auth/v1/**', async (route) => {
    authCalls.push({ url: route.request().url(), body: route.request().postDataJSON?.() });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/auth/')) {
      authCalls.push({ url, body: route.request().postDataJSON?.() });
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    }
    return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
  });
  await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' });
  return { context, page, errors, authCalls };
}

test('sign-in asks for an email and nothing else', async () => {
  // There is no password field any more. The reset flow it implied ran on a
  // third party's domain, with a link that 404'd, and it locked the owner out
  // of his own product — see src/pages/Login.jsx. No password, nothing to
  // reset, nothing to break.
  const { context, page } = await authPage('/login');
  try {
    assert.equal(await page.locator('input[type="password"]').count(), 0,
      'a password field means a reset flow, and a reset flow is what broke');
    await page.getByLabel('Email').waitFor();
    await page.getByRole('button', { name: /Email me a sign-in link/i }).waitFor();
  } finally { await context.close(); }
});

test('asking for a link sends the request and says so', async () => {
  const { context, page, authCalls } = await authPage('/login');
  try {
    await page.getByLabel('Email').fill('owner@example.com');
    await page.getByRole('button', { name: /Email me a sign-in link/i }).click();
    await page.getByRole('heading', { name: /Check your email/i }).waitFor({ timeout: 10000 });
    assert.ok(authCalls.length >= 1, 'no request left the browser');
  } finally { await context.close(); }
});

test('the confirmation never reveals whether that email has an account', async () => {
  // This endpoint would otherwise answer, to anybody who asks, whether a given
  // address is a BillTap customer. The wording is deliberately conditional.
  const { context, page } = await authPage('/login');
  try {
    await page.getByLabel('Email').fill('definitely-not-a-user@example.com');
    await page.getByRole('button', { name: /Email me a sign-in link/i }).click();
    await page.getByRole('heading', { name: /Check your email/i }).waitFor({ timeout: 10000 });
    const text = await page.locator('body').innerText();
    assert.match(text, /If .* has a BillTap account/i);
    assert.ok(!/no account|not found|unknown/i.test(text), 'the screen disclosed whether the address exists');
  } finally { await context.close(); }
});

test('a failure to send is reported without disclosing anything either', async () => {
  const context = await browser.newContext({ viewport: PHONE, userAgent: IPHONE_UA, isMobile: true });
  const page = await context.newPage();
  try {
    await page.route('**/auth/**', (r) =>
      r.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"rate limited"}' }));
    await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Email').fill('owner@example.com');
    await page.getByRole('button', { name: /Email me a sign-in link/i }).click();
    await page.getByRole('alert').waitFor({ timeout: 10000 });
    const text = await page.getByRole('alert').innerText();
    assert.match(text, /Could not send/i);
    assert.ok(!/no account|not found/i.test(text));
  } finally { await context.close(); }
});

test('the old reset links land on sign-in instead of a dead end', async () => {
  // Both paths are in Base44's old emails and in people's history. A 404 is the
  // worst answer for somebody who is already unable to get in, which is exactly
  // how this migration started.
  for (const path of ['/forgot-password', '/reset-password?token=stale']) {
    const context = await browser.newContext({ viewport: PHONE, userAgent: IPHONE_UA, isMobile: true });
    const page = await context.newPage();
    try {
      const response = await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' });
      assert.equal(response.status(), 200, `${path} answered ${response.status()}`);
      await page.getByRole('button', { name: /Email me a sign-in link/i }).waitFor({ timeout: 10000 });
    } finally { await context.close(); }
  }
});

test('signing up is the same screen, not a second one to get wrong', async () => {
  const context = await browser.newContext({ viewport: PHONE, userAgent: IPHONE_UA, isMobile: true });
  const page = await context.newPage();
  try {
    await page.goto(`${base}/register`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Email me a sign-in link/i }).waitFor({ timeout: 10000 });
  } finally { await context.close(); }
});

test('the sign-in screen says out loud that splitting needs no account', async () => {
  // The single most important property of this product, stated where somebody
  // who wandered onto the login page by mistake will read it.
  const { context, page } = await authPage('/login');
  try {
    // Waited for, not assumed. authPage returns at domcontentloaded, and
    // reading body text before React has rendered gets a single letter of the
    // shell — which fails with a message that looks nothing like the cause.
    await page.getByRole('button', { name: /Email me a sign-in link/i }).waitFor({ timeout: 10000 });
    assert.match(await page.locator('body').innerText(), /never needs an account/i);
  } finally { await context.close(); }
});

test('the recovery pages fit a phone and log nothing', async () => {
  for (const path of ['/forgot-password', '/reset-password?token=abc']) {
    const { context, page, errors } = await authPage(path);
    try {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 1, `${path} overflowed by ${overflow}px`);
      assert.deepEqual(errors.filter((e) => !IGNORED_CONSOLE.test(e)), []);
    } finally { await context.close(); }
  }
});

// ── The security page ───────────────────────────────────────────────────────

test('the security page renders and is reachable from the footer', async () => {
  const { context, page, errors } = await phone();
  try {
    await page.goto(`${base}/security`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Security', level: 1 }).waitFor({ timeout: 10000 });
    const text = await page.locator('#root').innerText();
    assert.match(text, /never see a card number/i);
    assert.match(text, /security@billtap\.app/);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, `overflowed by ${overflow}px`);
    assert.deepEqual(errors.filter((e) => !IGNORED_CONSOLE.test(e)), []);
  } finally { await context.close(); }
});

test('the gaps are on the page, not buried in a comment', async () => {
  // The section that makes the rest of the page worth reading. If it is ever
  // quietly dropped for looking bad next to a competitor, this fails.
  const { context, page } = await phone();
  try {
    await page.goto(`${base}/security`, { waitUntil: 'networkidle' });
    const text = await page.locator('#root').innerText();
    assert.match(text, /have not had a third-party penetration test/i);
    assert.match(text, /hold no security certification/i);
    assert.match(text, /Encryption at rest is our providers/i);
  } finally { await context.close(); }
});

test('a researcher can find the reporting route without reading prose', async () => {
  const { context, page } = await phone();
  try {
    await page.goto(`${base}/security`, { waitUntil: 'networkidle' });
    const mailto = page.getByRole('link', { name: /security@billtap\.app/ });
    assert.equal(await mailto.getAttribute('href'), 'mailto:security@billtap.app');
    const wellKnown = page.getByRole('link', { name: /security\.txt/ });
    assert.equal(await wellKnown.getAttribute('href'), '/.well-known/security.txt');
  } finally { await context.close(); }
});

test('the security page is in the prerendered HTML, not only after React boots', async () => {
  // Vendor questionnaires and crawlers do not run JavaScript.
  const res = await fetch(`${base}/security.html`);
  const html = await res.text();
  assert.match(html, /never see a card number/i);
  assert.match(html, /penetration test/i);
});

// ── How long a scan takes ───────────────────────────────────────────────────
//
// "Scanning takes too long" has been the standing complaint about this product.
// The upload is the longest phase on a restaurant's wifi, and it used to wait
// for a button press that comes seconds after the photo is chosen.

test('the upload starts when the photo is chosen, not when the button is tapped', async () => {
  const { context, page, uploadCalls } = await phone();
  try {
    await page.goto(`${base}/new-receipt`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Upload receipt photo/i }).waitFor();
    await page.locator('#file-input').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: PNG_1PX });

    // Nobody has pressed anything yet.
    await page.waitForTimeout(1500);
    assert.equal(uploadCalls.length, 1,
      'the network sat idle here — the seconds between picking a photo and finding the button');
  } finally { await context.close(); }
});

test('a scan does not upload the same photo twice', async () => {
  const { context, page, uploadCalls } = await phone();
  try {
    await toReview(page);
    assert.equal(uploadCalls.length, 1, 'the background upload is reused, not repeated');
  } finally { await context.close(); }
});

test('retaking the photo uploads the new one, and the scan uses it', async () => {
  // The bug worth guarding: matching the second photo with the first upload is
  // a receipt for the wrong table.
  const { context, page, uploadCalls, created } = await phone({ hostSession: HOST_SESSION });
  try {
    await page.goto(`${base}/new-receipt`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Upload receipt photo/i }).waitFor();
    await page.locator('#file-input').setInputFiles({ name: 'first.png', mimeType: 'image/png', buffer: PNG_1PX });
    await page.waitForTimeout(500);
    await page.locator('#file-input').setInputFiles({ name: 'second.png', mimeType: 'image/png', buffer: PNG_1PX });
    await page.waitForTimeout(500);

    assert.equal(uploadCalls.length, 2);
    await page.getByRole('button', { name: /Parse Receipt with AI/i }).click();
    await page.getByRole('heading', { name: 'Olive Garden' }).waitFor({ timeout: 15000 });
    assert.equal(uploadCalls.length, 2, 'the second upload was already in hand');

    // And it is the SECOND photo that gets used. Carrying the first one
    // forward would attach the wrong table's receipt to this split.
    //
    // Matched on the object key rather than a stubbed response URL: the key is
    // minted per upload by uploadReceipt.js and the public URL is derived from
    // it, so this checks the thing the app actually stored rather than
    // something the test handed it.
    await page.getByRole('button', { name: /Show the QR code/i }).click();
    await page.waitForURL(/session-host/, { timeout: 10000 });
    const secondKey = new URL(uploadCalls[1].url).pathname.split('/').pop();
    assert.ok(
      created[0].image_url.includes(secondKey),
      `the split kept the first photo: stored ${created[0].image_url}, expected the key ${secondKey}`,
    );
  } finally { await context.close(); }
});

test('a slow upload is absorbed by the time spent looking at the preview', async () => {
  // The whole point. With a 2.5s upload, waiting before tapping should make the
  // scan finish sooner than tapping immediately would.
  const { context, page } = await phone({ uploadDelayMs: 2500 });
  try {
    await page.goto(`${base}/new-receipt`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Upload receipt photo/i }).waitFor();
    await page.locator('#file-input').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: PNG_1PX });

    // A person looking at their photo and finding the button.
    await page.waitForTimeout(2600);

    const started = Date.now();
    await page.getByRole('button', { name: /Parse Receipt with AI/i }).click();
    await page.getByRole('heading', { name: 'Olive Garden' }).waitFor({ timeout: 15000 });
    const afterTap = Date.now() - started;

    assert.ok(afterTap < 1500,
      `${afterTap}ms passed after the tap; the 2.5s upload should already have finished`);
  } finally { await context.close(); }
});

test('the arithmetic check costs no network call at all', async () => {
  // It was a third round trip, awaited before the diner saw anything, to add up
  // a column of numbers the phone was already holding.
  const { context, page } = await phone();
  const calls = [];
  try {
    page.on('request', (r) => { if (r.url().includes('validateReceiptParse')) calls.push(r.url()); });
    await toReview(page);
    assert.deepEqual(calls, []);
  } finally { await context.close(); }
});

test('a receipt that does not add up is still caught, without the server', async () => {
  const { context, page } = await phone({
    scan: { title: 'Olive Garden', items: [{ name: 'Steak', price: 20, quantity: 1 }], tax: 0, tip: 0, total: 95 },
  });
  try {
    await toReview(page);
    const text = await page.locator('body').innerText();
    assert.match(text, /hard to read/i, 'low confidence opens the editor and says why');
    assert.match(text, /20\.00/);
    assert.match(text, /95\.00/);
  } finally { await context.close(); }
});

test('a clean receipt is not accused of being hard to read', async () => {
  const { context, page } = await phone({
    scan: { title: 'Olive Garden', items: [{ name: 'Steak', price: 20, quantity: 1 }], tax: 2, tip: 3, total: 25 },
  });
  try {
    await toReview(page);
    const text = await page.locator('body').innerText();
    assert.ok(!/hard to read/i.test(text));
    assert.equal(await page.locator('input:visible').count(), 0, 'the editor stays shut');
  } finally { await context.close(); }
});

// ── Reading the receipt without Base44 ──────────────────────────────────────

test('the scan goes straight to our own endpoint, not through Base44', async () => {
  const { context, page, scanCalls } = await phone();
  try {
    await toReview(page);
    assert.equal(scanCalls.length, 1);
  } finally { await context.close(); }
});

test('the model no longer waits for the image to finish uploading', async () => {
  // The change that matters. With storage crawling at 4 seconds, the scan used
  // to sit behind it waiting for a URL; now the image goes to the model inline
  // and storage runs alongside.
  const { context, page } = await phone({ uploadDelayMs: 4000 });
  try {
    await page.goto(`${base}/new-receipt`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Upload receipt photo/i }).waitFor();
    await page.locator('#file-input').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: PNG_1PX });

    const started = Date.now();
    await page.getByRole('button', { name: /Parse Receipt with AI/i }).click();
    await page.getByRole('heading', { name: 'Olive Garden' }).waitFor({ timeout: 20000 });
    const elapsed = Date.now() - started;

    assert.ok(elapsed < 3000, `waited ${elapsed}ms behind a 4s upload that nothing needed`);
  } finally { await context.close(); }
});

test('a split still carries its receipt image, just not on the critical path', async () => {
  const { context, page, created, uploadCalls } = await phone({ uploadDelayMs: 1200, hostSession: HOST_SESSION });
  try {
    await toReview(page);
    await page.getByRole('button', { name: /Show the QR code/i }).click();
    await page.waitForURL(/session-host/, { timeout: 15000 });
    const key = new URL(uploadCalls[0].url).pathname.split('/').pop();
    assert.ok(created[0].image_url.includes(key), `stored ${created[0].image_url}, expected key ${key}`);
  } finally { await context.close(); }
});

test('a scan that cannot run says so, with a retry that could work', async () => {
  // There used to be a fallback through Base44's InvokeLLM here, and these two
  // tests asserted it. It has been removed on purpose: reaching Base44 needed a
  // Base44 session and operators are on Supabase now, so the "degraded" path
  // could only fail a second time — more slowly, after waiting on an upload the
  // fast path does not wait for.
  //
  // What replaces it is not nothing. The failure surfaces in ErrorNotice, in
  // the page, with the server's own sentence and a retry button that genuinely
  // can succeed — a busy model, a dropped connection. That is the behaviour
  // worth holding, so it is what is tested.
  const { context, page, scanCalls } = await phone({ directScan: false });
  try {
    await page.goto(`${base}/new-receipt`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Upload receipt photo/i }).waitFor();
    await page.locator('#file-input').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: PNG_1PX });
    await page.getByRole('button', { name: /Parse Receipt with AI/i }).click();

    await page.getByRole('alert').waitFor({ timeout: 15000 });
    assert.equal(scanCalls.length, 1, 'it tried once');

    const notice = await page.getByRole('alert').innerText();
    // Not a modal, and not "please try again" for a failure retrying cannot fix.
    assert.ok(notice.length > 0, 'the failure has to be visible in the page');
    assert.ok(
      !/undefined|\[object Object\]/i.test(notice),
      `the notice rendered a placeholder instead of a message: ${notice}`,
    );
  } finally { await context.close(); }
});

test('a failed scan creates no split, so nobody pays against a receipt we could not read', async () => {
  const { context, page, created } = await phone({ directScan: false, hostSession: HOST_SESSION });
  try {
    await page.goto(`${base}/new-receipt`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Upload receipt photo/i }).waitFor();
    await page.locator('#file-input').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: PNG_1PX });
    await page.getByRole('button', { name: /Parse Receipt with AI/i }).click();
    await page.getByRole('alert').waitFor({ timeout: 15000 });

    assert.deepEqual(created, [], 'a split was created from a receipt that was never read');
  } finally { await context.close(); }
});

// ── Layer 1: what a guest is actually made to download ──────────────────────
//
// Most of this product's traffic is a stranger at a restaurant table with one
// bar of signal who will never have an account. Every kilobyte on that path is
// paid for by somebody who did not choose to be here and cannot leave and come
// back later.
//
// These assert the shape of the loading, not a byte budget: a size threshold
// goes stale the week someone adds a page, and then it either fails constantly
// or gets raised until it means nothing.

/** Every URL the browser actually requested, in order. */
async function requestsFor(path) {
  const context = await browser.newContext({
    viewport: PHONE, deviceScaleFactor: 2, userAgent: IPHONE_UA, isMobile: true, hasTouch: true,
  });
  const urls = [];
  await context.route('**/*', (route) => {
    const url = route.request().url();
    urls.push(url);
    // Third parties are blocked rather than fetched: this measures what the app
    // asks for, and a test that reaches analytics is slow and flaky and mildly
    // rude.
    if (!url.startsWith(base)) return route.abort();
    return route.continue();
  });
  const page = await context.newPage();
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
  await context.close();
  return urls;
}

test('a guest never downloads the sign-in client', async () => {
  // It is 56 KB gzipped and it was in the entry chunk, so every diner fetched
  // the whole auth library before the page painted — to discover they are not
  // signed in, which they never will be. Loading it on demand took the entry
  // chunk from 223 KB to 168 KB gzipped.
  const urls = await requestsFor('/');
  const fetched = urls.filter((u) => u.startsWith(base) && u.endsWith('.js'));

  const auth = [];
  for (const url of fetched) {
    const file = join(DIST, new URL(url).pathname);
    if (!existsSync(file)) continue;
    if (readFileSync(file, 'utf8').includes('GoTrueClient')) auth.push(url);
  }

  assert.deepEqual(auth, [], `the auth client was downloaded by a guest: ${auth.join(', ')}`);
});

test('a sign-in link arriving in the URL loads the client, with nothing in storage', async () => {
  // The half that is easy to lose. A magic link lands with the session in the
  // address bar and nothing stored yet, so a storage-only check would make the
  // link silently do nothing — the exact failure this migration exists to end.
  //
  // Asserted against a real navigation because the same claim was a source grep
  // first, and a mutation test showed that blanking the URL check still passed:
  // the words it searched for also appeared in the comment above the code.
  const urls = await requestsFor('/#access_token=pretend&type=magiclink');
  const fetched = urls.filter((u) => u.startsWith(base) && u.endsWith('.js'));

  let found = false;
  for (const url of fetched) {
    const file = join(DIST, new URL(url).pathname);
    if (existsSync(file) && readFileSync(file, 'utf8').includes('GoTrueClient')) found = true;
  }
  assert.ok(found, 'a magic link would have done nothing at all');
});

test('the sign-in screen does download it, because that is what it is for', async () => {
  // The other half. Without this the first test passes just as well by the
  // client being broken, and nobody could sign in at all.
  const urls = await requestsFor('/login');
  const fetched = urls.filter((u) => u.startsWith(base) && u.endsWith('.js'));

  let found = false;
  for (const url of fetched) {
    const file = join(DIST, new URL(url).pathname);
    if (existsSync(file) && readFileSync(file, 'utf8').includes('GoTrueClient')) found = true;
  }

  assert.ok(found, 'the sign-in screen must load the auth client');
});
