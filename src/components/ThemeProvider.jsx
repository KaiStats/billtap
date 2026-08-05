import { useEffect } from "react";

/**
 * Puts the app in dark mode and keeps it there.
 *
 * This used to follow the OS: `apply(mq.matches)` on mount, plus a listener for
 * changes. That was wrong, and badly so, because there is no light theme to
 * switch to. Every page paints its own chrome with hard-coded dark hex —
 * #0a0e1a, #111827 — while the shadcn tokens in src/index.css only go dark
 * under a `.dark` ancestor. On a phone set to light mode this provider removed
 * that class, so --foreground resolved to 0 0% 3.9%: near-black type on the
 * page's own near-black background.
 *
 * Everything still rendered. Scanned receipt items, their prices, the bill
 * title — all present in the DOM, none of them readable. Placeholders looked
 * *brighter* than real values, because those use --muted-foreground at 45%
 * grey rather than --foreground at 4%. It read as "the app is broken" to
 * anyone whose phone happened to be in light mode, which is most people during
 * the day, at a table, which is exactly when this product gets used.
 *
 * So: dark, always. index.html also carries class="dark" so the first paint is
 * correct before React mounts; this keeps it that way afterwards.
 *
 * If a light theme is ever wanted, it needs the hard-coded hex in the pages
 * replaced with tokens first. Restoring the OS listener before that happens
 * just reintroduces the invisible text.
 */
export default /** @param {{ children?: any, [key: string]: any }} props */
function ThemeProvider({ children }) {
  useEffect(() => {
    document.documentElement.classList.add("dark");

    // iOS status bar. Translucent lets the page's own dark colour show through;
    // "default" would draw a light bar above a dark app.
    let meta = /** @type {HTMLMetaElement|null} */ (document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]'));
    if (!meta) {
      meta = /** @type {HTMLMetaElement} */ (document.createElement("meta"));
      meta.name = "apple-mobile-web-app-status-bar-style";
      document.head.appendChild(meta);
    }
    meta.content = "black-translucent";
  }, []);

  return children;
}
