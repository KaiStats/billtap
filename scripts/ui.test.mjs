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
 * Kept out of `npm test` on purpose — it needs Chromium, and CI has none. The
 * fast suites stay fast and browser-free.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const DIST = resolve(import.meta.dirname, '../dist');
const PHONE = { width: 390, height: 844 };
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

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
async function phone({ validation = null, scan = SCAN, onCreate } = {}) {
  const context = await browser.newContext({
    viewport: PHONE, deviceScaleFactor: 2, userAgent: IPHONE_UA, isMobile: true, hasTouch: true,
  });
  const errors = [];
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  const created = [];
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const send = (data) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });

    if (url.includes('UploadFile')) return send({ file_url: 'https://cdn.example/receipt.jpg' });
    if (url.includes('InvokeLLM')) return send(scan);
    if (url.includes('/fn/validateReceiptParse')) {
      return validation ? send(validation) : route.fulfill({ status: 500, body: '{}' });
    }
    if (url.includes('/fn/createSession')) {
      const payload = route.request().postDataJSON();
      created.push(payload);
      if (onCreate) onCreate(payload);
      return send({ session: { id: 'sess_test_1', ...payload } });
    }
    if (url.includes('/entities/User/me') || url.includes('/auth/me')) {
      return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"anon"}' });
    }
    return send({});
  });

  return { context, page, errors, created };
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
  const { context, page } = await phone({
    validation: { confidence: 'low', issues: { sumMismatch: true, calculatedTotal: '61.40', expectedTotal: '75.00' } },
  });
  try {
    await toReview(page);
    assert.ok(await page.locator('input:visible').count() > 0, 'editing is already open');
    const text = await page.locator('body').innerText();
    assert.match(text, /hard to read/i);
    assert.match(text, /61\.40/);
    assert.match(text, /75\.00/);
  } finally { await context.close(); }
});

test('a middling scan asks for a look without opening the editor', async () => {
  const { context, page } = await phone({ validation: { confidence: 'medium' } });
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

test('a failed validation call never costs the diner their scan', async () => {
  // validateReceiptParse is stubbed to 500 by default; the items must survive.
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
    await page.waitForURL(/claim\?id=sess_test_1/, { timeout: 10000 });

    const sent = created[0];
    assert.equal(sent.title, 'Olive Garden');
    assert.equal(sent.items.length, 4);
    assert.equal(sent.tax, 4.2);
    assert.equal(sent.split_mode, 'itemized');
    assert.equal(Number(sent.tip.toFixed(2)), 11.44);
    assert.equal(Number(sent.total_amount.toFixed(2)), Number((SUBTOTAL + 4.2 + 11.44).toFixed(2)));
  } finally { await context.close(); }
});

test('a guest is taken to the claim screen, not bounced to a login', async () => {
  const { context, page } = await phone();
  try {
    await toReview(page);
    await page.getByRole('button', { name: /Show the QR code/i }).click();
    await page.waitForURL(/\/claim\?id=/, { timeout: 10000 });
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
    const real = errors.filter((e) => !/favicon|manifest|net::ERR|Failed to load resource/i.test(e));
    assert.deepEqual(real, []);
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
      const real = errors.filter((e) => !/favicon|manifest|net::ERR|Failed to load resource/i.test(e));
      assert.deepEqual(real, []);
    } finally { await context.close(); }
  });
}
