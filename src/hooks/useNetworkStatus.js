import { useEffect } from 'react';
import { toast } from '@/components/ui/use-toast';

/**
 * Global network status listener
 * Displays offline toast when connectivity is lost
 */
export function useNetworkStatus() {
  useEffect(() => {
    let offlineToastId = null;

    const handleOffline = () => {
      const { dismiss } = toast({
        title: 'Connection lost',
        description: 'Your split data is saved locally. Reconnecting when signal returns...',
        variant: 'destructive',
        duration: Infinity,
      });
      offlineToastId = dismiss;
    };

    const handleOnline = () => {
      // Dismiss offline toast
      if (offlineToastId) {
        offlineToastId();
        offlineToastId = null;
      }
      // Show reconnected toast
      toast({
        title: 'Back online',
        description: 'Syncing your changes...',
        variant: 'default',
        duration: 2000,
      });
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    // Check initial state
    if (!navigator.onLine) {
      handleOffline();
    }

    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      if (offlineToastId) {
        offlineToastId();
      }
    };
  }, []);
}