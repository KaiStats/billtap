import { useRef, useCallback } from "react";

/**
 * Persists scroll position for a tab key using sessionStorage.
 * Returns a ref to attach to the scrollable element, plus save/restore helpers.
 */
export function useSaveScroll(key) {
  const ref = useRef(null);

  const onScroll = useCallback(() => {
    if (ref.current) {
      sessionStorage.setItem(`scroll_${key}`, String(ref.current.scrollTop));
    }
  }, [key]);

  const restoreScroll = useCallback(() => {
    const saved = sessionStorage.getItem(`scroll_${key}`);
    if (ref.current && saved !== null) {
      ref.current.scrollTop = parseInt(saved, 10);
    }
  }, [key]);

  return { ref, onScroll, restoreScroll };
}