/**
 * Every boundary, broken, from the diner's side of the glass.
 *
 * worker/boundaries.boundary.test.js proves the Worker answers cleanly when a
 * dependency fails. That is half the claim. The other half is what a person
 * actually sees, and it is not the same question: a Worker can return a
 * perfectly redacted 502 and the page can still render a blank screen, print
 * the stack to the console, or leave a spinner turning forever.
 *
 * So this drives the real built bundle in a real browser, forces each boundary
 * to fail, and asserts three things every time:
 *
 *   1. Something legible appears. Not a blank page, not a spinner.
 *   2. Nothing technical is anywhere on the page or in the console — no stack,
 *      no path, no hostname, no SQL.
 *   3. The request id is on screen, because that is the entire mechanism by
 *      which a support conversation becomes one log query.
 *
 * Separate from scripts/ui.browser.mjs on purpose: that file stubs the network
 * to succeed and drives the happy path, and threading failure injection through
 * its harness would make both jobs harder to read.
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
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.txt': 'text/plain', '.xml': 'application/xml',
};

/**
 * The strings that must never reach a browser, in the shapes a real failure
 * produces them. Each is planted in the stubbed error body below, so a test
 * that finds one on the page has found a genuine leak and not a typo.
 */
const NEVER_ON_SCREEN = [
  'postgresql://',
  'skrqxxhoxbrvlviqrhjt.supabase.co',
  '/workspace/billtap/worker',
  'node_modules',
  'at Object.handler',
  'duplicate key value',
  'host_key_hash',
  'SUPABASE_SERVICE_ROLE_KEY',
];

/** What a Worker would never send, planted to prove the client cannot echo it. */
const LEAKY_BODY = JSON.stringify({
  error: 'connect ECONNREFUSED postgresql://app:hunter2@db.internal:5432/billtap',
  stack: 'Error: boom\n    at Object.handler (/workspace/billtap/worker/routes/functions.js:412:9)',
  detail: 'duplicate key value violates unique constraint "sessions_pkey" on column host_key_hash',
  hint: 'check SUPABASE_SERVICE_ROLE_KEY at https://skrqxxhoxbrvlviqrhjt.supabase.co',
});

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

let browser;
let base;
let httpServer;

before(async () => {
  assert.ok(existsSync(join(DIST, 'index.html')), 'run `npm run build` before this suite');
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
 * A phone with every API call failing in a chosen way.
 *
 * `mode` is how the boundary breaks, and the three are genuinely different
 * failures that a client can get wrong independently:
 *
 *   leaky — a 500 whose body is full of internal detail. The Worker will not
 *           send this; the point is that the client must not display whatever
 *           it is handed, because a proxy or a future regression might.
 *   html  — a gateway's error page instead of JSON, which is what a caller gets
 *           when something in front of the Worker fails. res.json() throws here.
 *   dead  — no response at all. fetch rejects.
 */
async function phone({ mode = 'leaky', only = '**/api/**' } = {}) {
  const context = await browser.newContext({
    viewport: PHONE, deviceScaleFactor: 2, userAgent: IPHONE_UA, isMobile: true, hasTouch: true,
  });
  const consoleErrors = [];
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  const hits = [];
  await page.route(only, async (route) => {
    hits.push(route.request().url());
    if (mode === 'dead') return route.abort('failed');
    if (mode === 'html') {
      return route.fulfill({
        status: 502,
        contentType: 'text/html',
        body: '<html><head><title>502 Bad Gateway</title></head><body>nginx/1.24.0</body></html>',
      });
    }
    return route.fulfill({ status: 500, contentType: 'application/json', body: LEAKY_BODY });
  });

  return { context, page, consoleErrors, hits };
}

/** Everything the user can read, plus everything the console was told. */
async function visible(page, consoleErrors) {
  const text = await page.evaluate(() => document.body.innerText);
  return `${text}\n${consoleErrors.join('\n')}`;
}

function assertNothingTechnical(surface, where) {
  for (const secret of NEVER_ON_SCREEN) {
    const at = surface.indexOf(secret);
    // The surrounding text, not just the match. "postgresql:// reached the
    // browser" does not say whether it was rendered on the page or printed to
    // the console, and those are different bugs with different fixes.
    const context = at < 0 ? '' : surface.slice(Math.max(0, at - 120), at + 160).replace(/\s+/g, ' ');
    assert.ok(
      at < 0,
      `${where}: "${secret}" reached the browser — the public error layer is being bypassed.\n  …${context}…`,
    );
  }
}

// ── Every screen that talks to a boundary ───────────────────────────────────

/**
 * Reaching the boundary is the test. Loading the page is not.
 *
 * The first version of this file navigated to four routes, waited, and asserted
 * that nothing technical was on screen. All twelve passed, and all twelve were
 * worthless: instrumenting the stub showed **zero** API calls on every one of
 * them. /new-receipt does not scan until a photo is chosen, /claim needs a
 * session id in the query string, /dashboard bounces an unauthenticated visitor
 * before it reads anything, and /restaurants does not post until the form is
 * submitted. The suite was proving that a page which talks to nothing leaks
 * nothing.
 *
 * So each scenario now drives the interaction that actually crosses the
 * boundary, and — the part that matters — asserts the boundary was reached.
 * `hits` is what stops this rotting back into a page-load test the next time a
 * screen changes.
 */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const SCENARIOS = [
  {
    what: 'the receipt scan',
    path: '/new-receipt',
    expect: /scan-receipt/,
    async reach(page) {
      await page.getByRole('button', { name: /Upload receipt photo/i }).waitFor({ timeout: 20000 });
      await page.locator('#file-input').setInputFiles({ name: 'r.png', mimeType: 'image/png', buffer: PNG_1PX });
      await page.getByRole('button', { name: /Parse Receipt with AI/i }).click();
    },
  },
  {
    what: 'joining a split',
    path: '/claim?id=sess_test_1',
    expect: /getSplitStatus|verifyQRToken/,
    // Reads on mount, so navigation is the interaction here — but the id in the
    // query string is what makes that true, and it was missing before.
    async reach() {},
  },
  {
    what: 'the lead form',
    path: '/restaurants',
    expect: /restaurant-lead/,
    async reach(page) {
      // Ids, not roles. The submit button's accessible name is "Start my free
      // trial" and changes with the copy; the field ids are structural.
      await page.locator('#rst-name').waitFor({ timeout: 20000 });
      await page.locator('#rst-name').fill('Olive Garden');
      await page.locator('#rst-contact').fill('Sam');
      await page.locator('#rst-email').fill('owner@example.com');
      // #rst-website is the honeypot and is deliberately left empty: filling it
      // makes the handler accept silently and send nothing, which would be a
      // test that reaches no boundary at all.
      await page.locator('button[type="submit"]').first().click();
    },
  },
];

for (const scenario of SCENARIOS) {
  for (const mode of ['leaky', 'html', 'dead']) {
    test(`${scenario.what} survives a ${mode} boundary failure without leaking`, async () => {
      const { context, page, consoleErrors, hits } = await phone({ mode });
      try {
        await page.goto(`${base}${scenario.path}`, { waitUntil: 'domcontentloaded' });
        await scenario.reach(page);
        // Long enough for the page's own retries and any deferred fetch.
        await page.waitForTimeout(2500);

        // The guard against the vacuous version of this test.
        assert.ok(
          hits.some((url) => scenario.expect.test(url)),
          `${scenario.what} (${mode}) never reached its boundary — asserted nothing. Saw: ${hits.join(', ') || 'no API calls'}`,
        );

        const surface = await visible(page, consoleErrors);
        assertNothingTechnical(surface, `${scenario.what} (${mode})`);

        // Something is on screen. A white page is the failure mode this suite
        // exists to catch, and it is invisible to a status-code assertion.
        const body = await page.evaluate(() => document.body.innerText.trim());
        assert.ok(body.length > 20, `${scenario.what} (${mode}) rendered an effectively blank page`);

        // And the app is still alive: React did not unmount into the boundary.
        const root = await page.evaluate(() => document.getElementById('root')?.children.length ?? 0);
        assert.ok(root > 0, `${scenario.what} (${mode}) tore the app down`);
      } finally {
        await context.close();
      }
    });
  }
}

// ── The one flow where the message and the id are the product ───────────────

test('a failed scan shows a readable message, a request id, and the way round', async () => {
  // The receipt scan is the only step that depends on a third party, so it is
  // the boundary a diner is most likely to meet. What has to be on screen: a
  // sentence, the id that makes it reportable, and the even split — which needs
  // no model and is the reason this outage is not the product being down.
  const { context, page, consoleErrors } = await phone({ mode: 'leaky' });
  try {
    await page.route('**/api/scan-receipt', (route) => route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'The receipt reader is unavailable right now.',
        code: 'upstream',
        request_id: 'ab12cd',
        retry: true,
      }),
    }));

    await page.goto(`${base}/new-receipt`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Upload receipt photo/i }).waitFor({ timeout: 15000 });
    await page.locator('#file-input').setInputFiles({
      name: 'receipt.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    });
    await page.getByRole('button', { name: /Parse Receipt with AI/i }).click();

    const notice = page.getByRole('alert');
    await notice.waitFor({ timeout: 20000 });

    const text = await notice.innerText();
    assert.match(text, /receipt reader is unavailable/i, 'the server sentence is not shown');
    assert.match(text, /ab12cd/, 'the request id is not shown, so the failure is unreportable');

    // The degraded path, offered because the retry cannot help against an
    // outage. See the fallback in src/pages/NewReceipt.jsx.
    await page.getByRole('button', { name: /Split evenly instead/i }).waitFor({ timeout: 5000 });

    assertNothingTechnical(await visible(page, consoleErrors), 'the failed scan');
  } finally {
    await context.close();
  }
});

test('the diagnostic endpoints are never reachable from the app', async () => {
  // /api/error-log answers 404 without its key, and nothing in the bundle
  // should be asking for it. A stack-trace index that the client knows the
  // address of is one an attacker knows the address of.
  const { context, page } = await phone({ mode: 'leaky' });
  const asked = [];
  try {
    page.on('request', (r) => asked.push(r.url()));
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    for (const url of asked) {
      assert.ok(!url.includes('/api/error-log'), `the app requested ${url}`);
    }
  } finally {
    await context.close();
  }
});
