import { useEffect } from 'react';

/**
 * Hook to disable overscroll bounce on mobile WebViews
 * Applies overscroll-behavior: none to prevent native scroll bouncing
 */
export function useScrollBehavior(elementRef = null) {
  useEffect(() => {
    const element = elementRef?.current || document.documentElement;
    
    if (!element) return;

    // Apply overscroll-behavior: none
    const originalBehavior = element.style.overscrollBehavior;
    element.style.overscrollBehavior = 'none';

    // Also set on body for comprehensive coverage
    const originalBodyBehavior = document.body.style.overscrollBehavior;
    document.body.style.overscrollBehavior = 'none';

    return () => {
      element.style.overscrollBehavior = originalBehavior;
      document.body.style.overscrollBehavior = originalBodyBehavior;
    };
  }, [elementRef]);
}