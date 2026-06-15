import { useState, useEffect } from 'react';

/**
 * Smart polling hook — pauses automatically when the tab is hidden.
 * Saves API calls and battery when the user switches away.
 */
export function useSmartPoll(fn, interval = 3000) {
  const [isVisible, setIsVisible] = useState(!document.hidden);

  useEffect(() => {
    const handleVisibility = () => setIsVisible(!document.hidden);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    const timer = setInterval(fn, interval);
    return () => clearInterval(timer);
  }, [fn, interval, isVisible]);
}