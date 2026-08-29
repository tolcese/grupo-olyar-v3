const CACHE_NAME = 'grupo-olyar-v3.8.5';

// Solo cacheamos iconos y manifest — el index.html siempre va a la red
const STATIC_ASSETS = [
  '/grupo-olyar-v3/manifest.json',
  '/grupo-olyar-v3/icons/icon-192.png',
  '/grupo-olyar-v3/icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    // add() individual con catch: si falta un icono, el install NO falla
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(STATIC_ASSETS.map(u => cache.add(u).catch(() => {})))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Supabase y APIs externas: siempre red
  if (url.hostname.includes('supabase.co') ||
      url.hostname.includes('wttr.in') ||
      url.hostname.includes('cdnjs') ||
      url.hostname.includes('unpkg') ||
      url.hostname.includes('fonts.googleapis') ||
      url.hostname.includes('fonts.gstatic')) {
    return;
  }

  // Páginas .html (index, datero): siempre network-first para versión actualizada
  if (url.pathname.endsWith('/') || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // Iconos y manifest: cache-first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
