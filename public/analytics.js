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
 * Served from /analytics.js, which is inside the assets directory and therefore
 * covered by the Cache-Control rules in public/_headers. Loaded with `defer` so
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

// ── Meta Pixel ──────────────────────────────────────────────────────────────
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

fbq('init', '2102574843552117');
fbq('trackCustom', 'PageView');

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
