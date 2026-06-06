const CACHE_NAME = 'billtap-v1';
const CORE_FILES = [
  '/',
  '/index.html',
];

// Install event - cache core files
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Installed — billtap-v1');
        return cache.addAll(CORE_FILES);
      })
      .catch((err) => {
        console.error('[SW] Cache install failed:', err);
      })
  );
});

// Fetch event - cache-first strategy
self.addEventListener('fetch', (event) => {
  const request = event.request;
  
  // Skip non-GET requests
  if (request.method !== 'GET') return;
  
  // Skip chrome-extension and other non-http requests
  if (!request.url.startsWith('http')) return;
  
  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          console.log('[SW] Cache hit:', request.url);
          return cachedResponse;
        }
        
        console.log('[SW] Network fetch:', request.url);
        return fetch(request)
          .then((networkResponse) => {
            // Don't cache failed responses or non-success status
            if (!networkResponse || networkResponse.status !== 200) {
              return networkResponse;
            }
            
            // Clone the response for caching
            const responseToCache = networkResponse.clone();
            
            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(request, responseToCache);
              })
              .catch((err) => {
                console.error('[SW] Cache put failed:', err);
              });
            
            return networkResponse;
          })
          .catch((err) => {
            console.log('[SW] Offline — serving fallback');
            // Return offline fallback
            return new Response(
              '<html><body><h1>You are offline</h1><p>BillTap requires an internet connection.</p></body></html>',
              {
                status: 503,
                headers: { 'Content-Type': 'text/html' }
              }
            );
          });
      })
  );
});

// Activate event - cleanup old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log('[SW] Activated — old caches cleaned');
        return self.clients.claim();
      })
  );
});
