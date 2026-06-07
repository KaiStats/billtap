const CACHE_NAME = 'billtap-v3';

const PRECACHE_URLS = [
  '/',
  '/offline.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon.svg',
];

// Install: precache critical assets including offline.html
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for API/dynamic, cache-first for static assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin requests
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Skip base44 API / SDK calls — never cache these
  if (url.pathname.startsWith('/api/') || url.hostname.includes('base44')) return;

  // For navigation requests: network-first, fall back to offline.html
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .catch(async () => {
          const offlineResponse = await caches.match('/offline.html');
          return offlineResponse || new Response('Offline', { status: 503 });
        })
    );
    return;
  }

  // For static assets (JS, CSS, images): cache-first
  if (
    url.pathname.match(/\.(js|css|png|svg|ico|woff2?|ttf)$/)
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        }).catch(async () => {
          const offlineResponse = await caches.match('/offline.html');
          return offlineResponse || new Response('Offline', { status: 503 });
        });
      })
    );
    return;
  }

  // Default: network only (don't cache dynamic routes)
  event.respondWith(
    fetch(request).catch(async () => {
      const offlineResponse = await caches.match('/offline.html');
      return offlineResponse || new Response('Offline', { status: 503 });
    })
  );
});
