import { useRef, useCallback } from "react";

// Per-tab scroll position memory
const scrollPositions = {};

export function useSaveScroll(tabKey) {
  const ref = useRef(null);

  const onScroll = useCallback(() => {
    if (ref.current) {
      scrollPositions[tabKey] = ref.current.scrollTop;
    }
  }, [tabKey]);

  const restoreScroll = useCallback(() => {
    if (ref.current && scrollPositions[tabKey] !== undefined) {
      ref.current.scrollTop = scrollPositions[tabKey];
    }
  }, [tabKey]);

  return { ref, onScroll, restoreScroll };
}