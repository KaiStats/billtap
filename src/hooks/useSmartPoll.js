import { useState, useEffect, useRef } from 'react';

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Smart polling hook — pauses when tab is hidden OR user is idle for 5 min.
 * Saves API calls and battery at the restaurant table.
 */
export function useSmartPoll(fn, interval = 3000) {
  const [isVisible, setIsVisible] = useState(!document.hidden);
  const [isIdle, setIsIdle] = useState(false);
  const idleTimerRef = useRef(null);

  // Track visibility
  useEffect(() => {
    const handleVisibility = () => setIsVisible(!document.hidden);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  // Track idle — reset on any touch/pointer/key activity
  useEffect(() => {
    const resetIdle = () => {
      setIsIdle(false);
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => setIsIdle(true), IDLE_TIMEOUT_MS);
    };
    resetIdle(); // start timer immediately
    window.addEventListener('touchstart', resetIdle, { passive: true });
    window.addEventListener('pointermove', resetIdle, { passive: true });
    window.addEventListener('keydown', resetIdle);
    return () => {
      clearTimeout(idleTimerRef.current);
      window.removeEventListener('touchstart', resetIdle);
      window.removeEventListener('pointermove', resetIdle);
      window.removeEventListener('keydown', resetIdle);
    };
  }, []);

  useEffect(() => {
    if (!isVisible || isIdle) return;
    const timer = setInterval(fn, interval);
    return () => clearInterval(timer);
  }, [fn, interval, isVisible, isIdle]);
}