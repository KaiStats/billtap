import { useEffect } from "react";

/**
 * Syncs the app's color scheme with the OS/iOS system dark mode preference.
 * Adds/removes the "dark" class on <html> and listens for changes.
 */
export default function ThemeProvider({ children }) {
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");

    const apply = (dark) => {
      document.documentElement.classList.toggle("dark", dark);
    };

    apply(mq.matches);
    mq.addEventListener("change", (e) => apply(e.matches));
    return () => mq.removeEventListener("change", (e) => apply(e.matches));
  }, []);

  return children;
}