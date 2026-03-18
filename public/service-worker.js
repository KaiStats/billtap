/**
 * Optimized Service Worker with Core Shell Precaching
 * 
 * Strategy:
 * - Precache: Core app shell (html, js, css, fonts) only
 * - Runtime Cache: Images (StaleWhileRevalidate), APIs (NetworkFirst), Fonts (CacheFirst)
 * - Memory footprint: <20MB initial, scales with usage
 */

import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { StaleWhileRevalidate, NetworkFirst, CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

// Clean up old caches from previous versions
cleanupOutdatedCaches();

// ============================================================================
// PRECACHE: Core App Shell Only (Injected by Workbox build)
// ============================================================================
precacheAndRoute(self.__WB_MANIFEST || []);

// ============================================================================
// RUNTIME CACHING: Images (Lazy-Loaded)
// ============================================================================
registerRoute(
  ({ request }) => request.destination === 'image',
  new StaleWhileRevalidate({
    cacheName: 'images-cache-v1',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
      }),
    ],
  })
);

// Alternative: Cache images by URL pattern
registerRoute(
  /\.(png|jpg|jpeg|gif|webp|svg)$/i,
  new StaleWhileRevalidate({
    cacheName: 'images-cache-v1',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 30 * 24 * 60 * 60,
      }),
    ],
  })
);

// ============================================================================
// RUNTIME CACHING: API Calls (Network First)
// ============================================================================
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/') || url.origin === 'https://api.base44.com',
  new NetworkFirst({
    cacheName: 'api-cache-v1',
    networkTimeoutSeconds: 5, // 5s timeout before fallback to cache
    plugins: [
      new ExpirationPlugin({
        maxEntries: 20,
        maxAgeSeconds: 5 * 60, // 5 minutes cache time for API
      }),
    ],
  })
);

// ============================================================================
// RUNTIME CACHING: Fonts (Cache First - Never Revalidate)
// ============================================================================
registerRoute(
  ({ request }) => request.destination === 'font',
  new CacheFirst({
    cacheName: 'fonts-cache-v1',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 20,
        maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
      }),
    ],
  })
);

// ============================================================================
// SKIP WAITING: Allow faster updates
// ============================================================================
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ============================================================================
// LOGGING: Optional debugging
// ============================================================================
if (process.env.NODE_ENV === 'development') {
  console.log('[SW] Service worker active with optimized core-shell precaching');
  console.log('[SW] Precached: Core shell (html, js, css, fonts)');
  console.log('[SW] Runtime: Images, APIs, Fonts');
}
