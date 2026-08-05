/**
 * Register service worker for PWA caching
 * Disabled in dev/preview environments
 */

export async function registerServiceWorker() {
  // ── What used to be here, and why it undid the whole feature ──────────────
  //
  // Every call unregistered *every* registration before registering again —
  // including the one the previous page load had just installed. So the worker
  // was torn down and rebuilt on each navigation: a fresh install, the whole
  // precache refetched, `clients.claim()` again, and never once the thing a
  // service worker is for, which is being already there when the page starts.
  //
  // It was written to clear out a broken worker, and for that it was never
  // needed. `register()` on the same URL refetches the script and, if the bytes
  // differ, installs the new one and discards the old — that is the update
  // path, and it is the only one that has ever been required here because the
  // script has always lived at /service-worker.js.
  //
  // What unregistering IS still for: a worker registered at some other scope,
  // which `register()` below cannot reach and which would go on answering
  // fetches for a script this app no longer ships. Those get cleared; ours is
  // left alone to do its job.

  // Skip registration on anything that is not a real deployment. A service
  // worker caches aggressively and outlives the tab, so one registered against
  // a dev server keeps serving stale bundles long after it is shut down.
  const hostname = window.location.hostname;
  const isPreview = hostname === 'localhost' || hostname === '127.0.0.1';
  if (import.meta.env.DEV || isPreview) {
    return;
  }

  if (!navigator.serviceWorker) return;

  const SCRIPT = '/service-worker.js';

  /**
   * True for a registration this app installed. An unknown script URL — no
   * active, installing or waiting worker to read one from — counts as ours, so
   * the ambiguous case is "leave it alone" rather than "tear it down".
   */
  const isOurs = (r) => {
    const url = r.active?.scriptURL || r.waiting?.scriptURL || r.installing?.scriptURL;
    if (!url) return true;
    return new URL(url, window.location.origin).pathname === SCRIPT;
  };

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.filter((r) => !isOurs(r)).map((r) => r.unregister()));
  } catch {
    // Storage denied, or a browser that will not enumerate. Registration below
    // is what matters and does not depend on this having worked.
  }

  try {
    const registration = await navigator.serviceWorker.register(SCRIPT, {
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