// MargeUp - Service Worker PWA (Offline first pour les chantiers)
const CACHE_NAME = 'margeup-cache-v2';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './supabase.js',
  './manifest.webmanifest',
  './images/logo.png',
  './images/logo-256.png',
  './images/chantier.jpg',
  './images/engins.jpg',
  './images/tuyaux.jpg',
  './images/outillage.jpg',
  './images/immeubles.jpg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS_TO_CACHE).catch(err => {
        console.warn('[SW] Certains fichiers non mis en cache :', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);
  const isAppShell = requestUrl.origin === self.location.origin &&
    (event.request.mode === 'navigate' || /\.(html|js|css)$/.test(requestUrl.pathname));

  // Toujours récupérer les pages et scripts à jour après une publication.
  if (isAppShell) {
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' }).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache));
        }
        return networkResponse;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // Pour les autres ressources, conserver la stratégie Stale-While-Revalidate.
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      const fetchPromise = fetch(event.request).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache));
        }
        return networkResponse;
      }).catch(() => cachedResponse);
      return cachedResponse || fetchPromise;
    })
  );
});

