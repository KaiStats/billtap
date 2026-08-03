/**
 * Register service worker for PWA caching
 * Disabled in dev/preview environments
 */

export async function registerServiceWorker() {
  // Always unregister any existing broken service workers first
  if (navigator.serviceWorker) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        await registration.unregister();
      }
    } catch (e) {
      // ignore
    }
  }

  // Skip registration on anything that is not a real deployment. A service
  // worker caches aggressively and outlives the tab, so one registered against
  // a dev server keeps serving stale bundles long after it is shut down.
  const hostname = window.location.hostname;
  const isPreview = hostname === 'localhost' || hostname === '127.0.0.1';
  if (import.meta.env.DEV || isPreview) {
    return;
  }

  if (!navigator.serviceWorker) return;

  try {
    const registration = await navigator.serviceWorker.register('/service-worker.js', {
      scope: '/',
      updateViaCache: 'none',
    });
    return registration;
  } catch (error) {
    console.warn('[SW] Registration failed:', error);
  }
}

export async function unregisterServiceWorkers() {
  if (!navigator.serviceWorker) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  for (const registration of registrations) {
    await registration.unregister();
  }
}

export function sendMessageToServiceWorker(message) {
  if (!navigator?.serviceWorker?.controller) return;
  navigator.serviceWorker.controller.postMessage(message);
}