/**
 * The Content-Security-Policy, and the two things that kept undermining it.
 *
 * `script-src 'unsafe-inline'` was there for two vendor analytics snippets. It
 * is not a small concession: with that token, any injected <script> in the page
 * executes, which is most of what the policy exists to prevent. Two tags were
 * holding the door open for everything.
 *
 * Removing it has a second-order failure that is easy to miss and silent when
 * it happens: an inline `onload=` attribute is also blocked. The font <link>
 * had one. Without it the preload still fetches, the page still renders, and
 * every headline falls back to system sans permanently — with nothing in the
 * console unless you are looking for it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const html = read('index.html');

/**
 * The markup, without the comments.
 *
 * The comments in index.html explain at length what was removed and why —
 * including the exact `onload="this.rel='stylesheet'"` that must never come
 * back, quoted so the next person understands the hazard. Scanning the raw text
 * would make documenting the rule a way to break it, which is the same trap the
 * sign-out test fell into. What the browser parses is the invariant.
 */
const markup = html.replace(/<!--[\s\S]*?-->/g, '');

const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];

/** One directive from the policy, as a list of sources. */
const directive = (name) => {
  const found = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `));
  return found ? found.slice(name.length + 1).split(/\s+/) : [];
};

test('the policy exists and parses', () => {
  assert.ok(csp, 'no Content-Security-Policy meta tag');
});

test("script-src does not allow 'unsafe-inline'", () => {
  assert.ok(
    !directive('script-src').includes("'unsafe-inline'"),
    "script-src allows 'unsafe-inline', which permits any injected script to run — " +
    'put the tag in public/analytics.js instead',
  );
});

test("script-src does not allow 'unsafe-eval' or a wildcard", () => {
  const sources = directive('script-src');
  assert.ok(!sources.includes("'unsafe-eval'"), "script-src allows 'unsafe-eval'");
  assert.ok(!sources.includes('*'), 'script-src allows any origin');
  assert.ok(!sources.includes('data:'), 'script-src allows data: URLs, which is a bypass');
});

test('the directives that do not inherit from default-src are all set', () => {
  // base-uri is the sharpest: without it one injected <base> repoints every
  // relative URL, including the module scripts, and script-src 'self' still
  // passes because 'self' resolves against the base.
  for (const name of ['base-uri', 'form-action', 'object-src', 'frame-src']) {
    assert.ok(directive(name).length, `${name} is absent and does not inherit from default-src`);
  }
  assert.deepEqual(directive('object-src'), ["'none'"]);
});

test('no inline event handler survives in the HTML', () => {
  // The failure mode this catches is silent. Anything matching on*="..." is
  // blocked by the policy above and will simply never run.
  const handlers = [...markup.matchAll(/\s(on[a-z]+)=["'][^"']*["']/g)]
    .map((m) => m[1])
    // http-equiv meta tags and the comments explaining this are not handlers.
    .filter((name) => name !== 'on');

  assert.deepEqual(
    handlers,
    [],
    `inline event handler(s) in index.html: ${handlers.join(', ')} — the CSP blocks these, ` +
    'move the behaviour into a file under public/',
  );
});

test('no inline <script> block survives in the HTML', () => {
  const inline = [...markup.matchAll(/<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?<\/script>/g)];
  assert.equal(
    inline.length,
    0,
    'an inline <script> in index.html will be blocked — put it in public/ and load it with src',
  );
});

test('the analytics tags are still actually loaded', () => {
  // Moving them out must not quietly turn them off.
  assert.match(html, /<script defer src="\/analytics\.js">/, 'analytics.js is not loaded');
  const analytics = read('public/analytics.js');
  assert.match(analytics, /fbq\('init'/, 'the Meta Pixel init is missing');
  assert.match(analytics, /gtag\('config'/, 'the Google tag config is missing');
  assert.match(analytics, /googletagmanager\.com\/gtag\/js/, 'the Google tag loader is missing');
});

test('the fonts are still actually applied', () => {
  assert.match(html, /<script defer src="\/fonts\.js">/, 'fonts.js is not loaded');
  assert.match(html, /rel="preload"\s+as="style"\s+data-fonts/, 'the preload lost its data-fonts hook');
  const fonts = read('public/fonts.js');
  assert.match(fonts, /link\[rel="preload"\]\[as="style"\]\[data-fonts\]/, 'fonts.js looks for a different element');
  assert.match(fonts, /rel = 'stylesheet'/, 'fonts.js never applies the stylesheet');
});

test('every origin script-src allows is one the app actually calls', () => {
  const allowed = directive('script-src').filter((s) => s.startsWith('http'));
  const analytics = read('public/analytics.js');
  for (const origin of allowed) {
    const host = new URL(origin).hostname;
    assert.ok(
      analytics.includes(host),
      `script-src allows ${origin} but nothing loads from it — remove it`,
    );
  }
});

// ── No manufactured social proof ────────────────────────────────────────────
//
// The pitch page carried "Mariposa | Cocina & Cocktails runs BillTap every
// service" under a "Live in Las Vegas" heading, beside "30 sec average time to
// split & pay". Mariposa was not a customer — a prospect who had not said yes —
// and the thirty seconds was invented. The comment above the section claimed it
// contained "deliberately no invented numbers".
//
// This guards the property rather than the wording, because the wording will
// change and the property must not: nothing on a public page may name a
// business as a customer, or state a performance metric, that is not true on
// the day it is read. The product sells review integrity. It cannot be caught
// manufacturing its own.

test('the pitch page names no restaurant as a customer', () => {
  const src = readFileSync(new URL('./pages/Restaurants.jsx', import.meta.url), 'utf8');
  // Everything outside a comment — the copy a visitor actually reads.
  const copy = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  assert.ok(!/Mariposa/i.test(copy),
    'a named restaurant is back in the rendered copy — it must be a customer who agreed to be named');
  assert.ok(!/runs BillTap every service/i.test(copy));
  assert.ok(!/taking real tables today/i.test(copy));
});

test('the pitch page states no performance metric it cannot support', () => {
  const src = readFileSync(new URL('./pages/Restaurants.jsx', import.meta.url), 'utf8');
  const copy = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  // "30 sec average time to split & pay" was measured against nothing. A stat
  // block entry is `{ n: "...", l: "..." }`; the headline half is what a
  // skimming owner reads as a number, so that is what is checked.
  const stats = [...copy.matchAll(/\bn:\s*"([^"]+)"/g)].map((m) => m[1]);
  for (const stat of stats) {
    assert.ok(
      !/\b\d+\s*(sec|second|min|minute|hour|%|x)\b/i.test(stat),
      `"${stat}" is a performance claim on a public page — it needs a real measurement behind it, `
      + 'or it needs to not be there',
    );
  }
});

// ── Prerendered snapshots carry no third-party tags ─────────────────────────
//
// public/analytics.js loads the Meta Pixel and GTM at runtime, so by the time
// prerender serialises the DOM those have injected their own <script> tags —
// including a Facebook config URL carrying `domain=localhost`, because that is
// where the prerender ran. All twelve snapshots were shipping it: each telling
// Facebook it was a different site than it is, loading fbevents.js a second
// time, and throwing "fbq is not defined" in every visitor's console.
//
// Checked against dist/ when it exists, because that is the artifact that
// ships. A build has not always been run, so an absent dist is skipped rather
// than failed — the guard on prerender.mjs itself below always runs.

test('no prerendered snapshot carries a cross-origin script tag', () => {
  const dist = new URL('../dist/', import.meta.url);
  let files = [];
  try {
    files = readdirSync(dist).filter((f) => f.endsWith('.html'));
  } catch {
    return; // no build in this working tree
  }
  if (!files.length) return;

  for (const file of files) {
    const html = readFileSync(new URL(file, dist), 'utf8');
    const tags = [...html.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/gi)].map((m) => m[1]);
    const foreign = tags.filter((src) => /^https?:\/\//i.test(src));
    assert.deepEqual(
      foreign, [],
      `${file} ships a third-party script baked in at build time. analytics.js `
      + 'adds the real ones on the visitor\'s own browser, scoped to the real domain.',
    );
    assert.ok(
      !/domain=localhost/.test(html),
      `${file} tells a third party it is localhost — captured from the prerender machine`,
    );
  }
});

test('prerender strips what the build machine injected', () => {
  // The stripping itself, so the guard survives a dist that was never built.
  const src = readFileSync(new URL('../scripts/prerender.mjs', import.meta.url), 'utf8');
  assert.match(src, /querySelectorAll\('script'\)/, 'the snapshot no longer strips injected scripts');
  assert.match(src, /location\.origin/, 'cross-origin is how an injected tag is recognised');
});
