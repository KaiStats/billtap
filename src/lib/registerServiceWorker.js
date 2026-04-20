/**
 * Register service worker for PWA caching
 * Handles offline support and background sync
 */

export async function registerServiceWorker() {
  // Skip registration in development or non-HTTPS
  if (import.meta.env.DEV && !window.location.hostname === 'localhost') {
    console.log('[SW] Skipping registration in development');
    return;
  }

  if (!navigator.serviceWorker) {
    console.log('[SW] Service Workers not supported');
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register('/service-worker.js', {
      scope: '/',
      updateViaCache: 'none',
    });

    console.log('[SW] Registered successfully:', registration);

    // Check for updates periodically
    setInterval(() => {
      registration.update();
    }, 60 * 60 * 1000); // Every hour

    // Handle updates available
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          // New version available, notify user (optional)
          console.log('[SW] New version available');
          // You could dispatch a custom event here to notify the app
          window.dispatchEvent(new CustomEvent('sw-update-available'));
        }
      });
    });

    return registration;
  } catch (error) {
    console.error('[SW] Registration failed:', error);
  }
}

/**
 * Unregister all service workers (for cleanup/dev)
 */
export async function unregisterServiceWorkers() {
  const registrations = await navigator.serviceWorker.getRegistrations();
  for (const registration of registrations) {
    await registration.unregister();
  }
  console.log('[SW] All workers unregistered');
}

/**
 * Send message to active service worker
 */
export function sendMessageToServiceWorker(message) {
  if (!navigator.serviceWorker.controller) {
    console.warn('[SW] No active controller');
    return;
  }
  navigator.serviceWorker.controller.postMessage(message);
}