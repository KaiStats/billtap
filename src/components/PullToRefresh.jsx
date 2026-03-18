import { memo, useState, useRef, useCallback } from "react";
import { Loader2 } from "lucide-react";

const PULL_THRESHOLD = 70;

const PullToRefresh = memo(function PullToRefresh({ onRefresh, children }) {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(null);
  const containerRef = useRef(null);

  const handleTouchStart = useCallback((e) => {
    const container = containerRef.current;
    if (container && container.scrollTop === 0) {
      startY.current = e.touches[0].clientY;
    }
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (startY.current === null || refreshing) return;
    const dy = e.touches[0].clientY - startY.current;
    if (dy > 0) {
      e.preventDefault();
      setPullDistance(Math.min(dy * 0.5, PULL_THRESHOLD + 20));
    }
  }, [refreshing]);

  const handleTouchEnd = useCallback(async () => {
    if (pullDistance >= PULL_THRESHOLD && !refreshing) {
      setRefreshing(true);
      setPullDistance(0);
      await onRefresh?.();
      setRefreshing(false);
    } else {
      setPullDistance(0);
    }
    startY.current = null;
  }, [pullDistance, refreshing, onRefresh]);

  return (
    <div
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className="relative overflow-y-auto h-full"
      style={{ overscrollBehavior: "none" }}
    >
      {/* Pull indicator */}
      <div
        className="flex items-center justify-center transition-all duration-200 overflow-hidden"
        style={{ height: refreshing ? 48 : pullDistance > 0 ? pullDistance : 0 }}
      >
        <Loader2
          className={`w-5 h-5 text-purple-600 ${refreshing ? "animate-spin" : ""}`}
          style={{ transform: !refreshing ? `rotate(${(pullDistance / PULL_THRESHOLD) * 360}deg)` : undefined }}
        />
      </div>
      {children}
    </div>
  );
}