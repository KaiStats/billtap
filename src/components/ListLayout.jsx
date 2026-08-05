import { useCallback } from 'react';
import PullToRefresh from './PullToRefresh';
import { useScrollBehavior } from '@/hooks/useScrollBehavior';

/**
 * Layout wrapper for list-based pages
 * Automatically includes PullToRefresh and scroll behavior
 * 
 * @param {Object} props
 *   - onRefresh: async function to call on pull-to-refresh
 *   - children: page content
 *   - className: additional classes for container
 */
export default /** @param {{ onRefresh?: any, children?: any, className?: any, [key: string]: any }} props */
function ListLayout({ onRefresh, children, className = '' }) {
  // Disable overscroll bounce
  useScrollBehavior();

  // Handle refresh with loading state
  const handleRefresh = useCallback(async () => {
    if (onRefresh) {
      await onRefresh();
    }
  }, [onRefresh]);

  return (
    <div className={`min-h-screen bg-surface ${className}`}>
      <PullToRefresh onRefresh={handleRefresh}>
        {children}
      </PullToRefresh>
    </div>
  );
}