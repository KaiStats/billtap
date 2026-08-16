/**
 * The Meta Pixel and Google tag bootstraps, moved out of index.html.
 *
 * ── Why they are not inline any more ────────────────────────────────────────
 *
 * They were the only reason the Content-Security-Policy carried
 * `script-src 'unsafe-inline'`, and that one token undoes most of what a CSP is
 * for: with it, any injected <script> in the page executes, which is the exact
 * outcome the policy exists to prevent. Two vendor snippets were holding the
 * door open for everything.
 *
 * A file served from this origin needs only `'self'`. No nonce to plumb
 * through, no hash to recompute every time somebody adjusts a line — both of
 * those break silently, in production, in a way that is invisible until you
 * open a console.
 *
 * Served from /analytics.js, at the site root rather than under /assets — so it
 * is not covered by the immutable rule there and has a named rule of its own in
 * public/_headers (an hour fresh, then a day of stale-while-revalidate),
 * because this filename does not change when its contents do. Loaded with `defer` so
 * it does not block parsing; neither vendor needs to run before the page paints
 * and the Layer 1 work went to some trouble to make sure nothing else does
 * either.
 *
 * ── If you add another tag ──────────────────────────────────────────────────
 *
 * Put it here. Do not put it back in the HTML, and do not add 'unsafe-inline'
 * to make it work — src/csp.test.mjs fails on both.
 */

/* eslint-disable */

/**
 * Where the Meta Pixel is worth its weight, and where it is not.
 *
 * ── What it costs ───────────────────────────────────────────────────────────
 *
 * Measured against production on the guest path: fbevents.js is 105 KB over the
 * wire and 400 KB parsed, and the signals/config request behind it another
 * 35 KB / 134 KB. That is 140 KB of transfer and better than half a megabyte of
 * JavaScript to compile — 37% of everything a diner downloads, on a phone,
 * mid-meal, on a restaurant's wifi. The Claim page's own code is 11 KB of it.
 *
 * ── Why the guest surfaces are the wrong place for it ───────────────────────
 *
 * The Pixel exists to attribute and retarget paid traffic for the $149
 * restaurant plan. Somebody who scanned a table tent is a diner splitting a
 * bill: they are not the buyer, they will never be the buyer, and firing
 * PageView for them does not merely waste their bandwidth — it feeds Meta an
 * audience of restaurant *customers* as though they were restaurant *owners*,
 * which makes the modelling behind every ad worse. Taking it off these pages is
 * a targeting improvement that happens to also be the largest performance win
 * available anywhere on the critical path.
 *
 * ── Which way this fails ────────────────────────────────────────────────────
 *
 * A denylist, not an allowlist, and deliberately. Forgetting to add a new
 * *marketing* page to an allowlist would lose attribution silently and cost
 * real money in misread ad spend; forgetting to add a new *app* page here costs
 * 140 KB on a screen that is not on the hot path anyway. So anything
 * unrecognised keeps the Pixel.
 *
 * The list mirrors public/robots.txt, which enumerates the same surfaces for a
 * related reason — none of them is a page the public should meet.
 * src/csp.test.mjs holds the two in agreement.
 */
var PIXEL_FREE = [
  // Guest surfaces — every diner at every table, so the highest volume by far.
  '/claim', '/r/', '/f/',
  // Signed in. No crawl value, and no ad value either.
  '/home', '/dashboard', '/restaurant-dashboard', '/new-receipt', '/session-host',
  '/receipt-detail', '/profile', '/login', '/register', '/icon-generator', '/new',
];

// Trailing slash stripped so '/claim/' and '/claim' are the same page.
var pixelPath = location.pathname.replace(/\/+$/, '') || '/';
var wantsPixel = !PIXEL_FREE.some(function (prefix) {
  var bare = prefix.replace(/\/+$/, '');
  // Prefix match on a path boundary, so /r/<slug> follows /r/ while a future
  // /newsletter is not swallowed by /new.
  return pixelPath === bare || pixelPath.indexOf(bare + '/') === 0;
});

// ── Meta Pixel ──────────────────────────────────────────────────────────────
if (wantsPixel)
!function (f, b, e, v, n, t, s) {
  if (f.fbq) return;
  n = f.fbq = function () {
    n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
  };
  if (!f._fbq) f._fbq = n;
  n.push = n;
  n.loaded = !0;
  n.version = '2.0';
  n.queue = [];
  t = b.createElement(e);
  t.async = !0;
  t.src = v;
  s = b.getElementsByTagName(e)[0];
  s.parentNode.insertBefore(t, s);
}(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');

if (wantsPixel) {
  fbq('init', '2102574843552117');
  fbq('trackCustom', 'PageView');
}

// ── Google tag ──────────────────────────────────────────────────────────────
//
// The loader was already an external script with `async`; only the config block
// below was inline. It is loaded here rather than left in the HTML so that both
// halves of the tag live in one place.
(function () {
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=G-XEEM8Q99JG';
  document.head.appendChild(s);
})();

window.dataLayer = window.dataLayer || [];
function gtag() { dataLayer.push(arguments); }
window.gtag = gtag;
gtag('js', new Date());
gtag('config', 'G-XEEM8Q99JG');
