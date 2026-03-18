import { useEffect } from "react";

/**
 * Syncs the app's color scheme with the OS/iOS system dark mode preference.
 * Adds/removes the "dark" class on <html> and listens for changes.
 */
export default function ThemeProvider({ children }) {
  const updateStatusBar = (isDark) => {
    let meta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "apple-mobile-web-app-status-bar-style";
      document.head.appendChild(meta);
    }
    meta.content = isDark ? "black-translucent" : "default";
  };

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");

    const apply = (dark) => {
      document.documentElement.classList.toggle("dark", dark);
      updateStatusBar(dark);
    };

    apply(mq.matches);
    const handler = (e) => apply(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return children;
}