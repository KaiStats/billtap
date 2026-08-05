/**
 * Applies the web font stylesheet, without an inline event handler.
 *
 * ── What this replaces, and why it had to move ──────────────────────────────
 *
 * index.html carried:
 *
 *   <link rel="preload" as="style" href="…" onload="this.onload=null;this.rel='stylesheet'">
 *
 * That `onload` is an inline event handler, and a Content-Security-Policy
 * without `script-src 'unsafe-inline'` blocks inline handlers exactly as it
 * blocks inline <script> blocks. Dropping 'unsafe-inline' — which is the whole
 * point of moving the analytics tags out — would have silently stopped the
 * fonts ever being applied. Silently: the preload still fetches, the page still
 * renders, and every headline just quietly falls back to system sans forever.
 *
 * ── Why the preload stays in the HTML ───────────────────────────────────────
 *
 * The two halves do different jobs. The <link rel="preload"> starts the fetch
 * during parse, at high priority, which is what the original was for. This
 * applies it afterwards, which is what stops it blocking first paint — the
 * failure the original comment records is a third-party stylesheet turning a
 * 376ms first paint into 13s when fonts.googleapis.com is slow or firewalled.
 *
 * Loaded with `defer`, so it runs after parsing and the stylesheet it appends
 * resolves instantly from the preload cache. If the preload never completes —
 * unreachable origin — this appends a link that also never completes, and
 * nothing waits on it: the page has already painted, and `display=swap` in the
 * URL means text was never hidden in the first place.
 */

(function () {
  var preload = document.querySelector('link[rel="preload"][as="style"][data-fonts]');
  if (!preload || !preload.href) return;

  var applied = false;
  function apply() {
    if (applied) return;
    applied = true;
    var sheet = document.createElement('link');
    sheet.rel = 'stylesheet';
    sheet.href = preload.href;
    document.head.appendChild(sheet);
  }

  /**
   * Only once the preload has actually arrived. This is the whole point.
   *
   * The first version of this file appended the stylesheet unconditionally, and
   * that is the original bug wearing new clothes: a <link rel="stylesheet"> to
   * a third-party origin blocks rendering until it resolves, so when
   * fonts.googleapis.com is slow, firewalled or unreachable the page cannot
   * paint — the 376ms first paint becoming 13s that the comment in index.html
   * records. The browser suite caught it, which is what that suite is for.
   *
   * Gating on the preload's own load event means a font origin that never
   * answers costs nothing at all: the preload fails quietly, this never runs,
   * and the fallback face renders exactly as `display=swap` intends.
   */
  preload.addEventListener('load', apply);

  /**
   * And the case where it arrived before this script ran.
   *
   * This file is deferred, so the preload may well have completed during
   * parsing — and a `load` event that has already fired does not fire again for
   * a listener added afterwards. A resource timing entry with a responseEnd is
   * the reliable way to ask "did this finish", where inspecting the link itself
   * is not: a preload has no `sheet` to check.
   */
  if (typeof performance !== 'undefined' && performance.getEntriesByName) {
    var entries = performance.getEntriesByName(preload.href);
    for (var i = 0; i < entries.length; i += 1) {
      if (entries[i].responseEnd > 0) { apply(); break; }
    }
  }
})();
