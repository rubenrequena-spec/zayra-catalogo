// ZAYRA PWA · Service Worker
// Estrategia: Cache-First con actualización en background
// Cada deploy nuevo cambia CACHE_VERSION → fuerza actualización automática

const CACHE_VERSION = 'zayra-v3-gifts';
const CACHE_ASSETS = [
  './catalogo-zayra.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];
// Cache separado para imágenes (no se pre-cachea, se llena bajo demanda)
const IMAGE_CACHE = 'zayra-images-v1';

// ─── INSTALL: cachear todo al instalar ───────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[ZAYRA SW] Instalando versión:', CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => {
        console.log('[ZAYRA SW] Cacheando assets...');
        return cache.addAll(CACHE_ASSETS);
      })
      .then(() => {
        // Activar el nuevo SW inmediatamente sin esperar
        return self.skipWaiting();
      })
  );
});

// ─── ACTIVATE: limpiar caches antiguas (pero mantener IMAGE_CACHE) ──────────
self.addEventListener('activate', event => {
  console.log('[ZAYRA SW] Activando:', CACHE_VERSION);
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_VERSION && name !== IMAGE_CACHE)
          .map(name => {
            console.log('[ZAYRA SW] Eliminando cache antigua:', name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      // Controlar todos los clientes abiertos inmediatamente
      return self.clients.claim();
    })
  );
});

// ─── FETCH: Cache-First con fallback a red ──────────────────────────────────
self.addEventListener('fetch', event => {
  // Solo interceptar requests GET
  if (event.request.method !== 'GET') return;

  // No interceptar requests a Google Fonts (siempre necesitan red)
  if (event.request.url.includes('fonts.googleapis.com') ||
      event.request.url.includes('fonts.gstatic.com')) {
    return;
  }

  // Las imágenes van a cache separado, cache-first puro (immutable)
  const url = new URL(event.request.url);
  const isImage = /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(url.pathname) ||
                  url.pathname.startsWith('/images/');

  if (isImage) {
    event.respondWith(
      caches.match(event.request, { cacheName: IMAGE_CACHE }).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(IMAGE_CACHE).then(c => c.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          // Tenemos cache → devolver inmediatamente Y actualizar en background
          const fetchPromise = fetch(event.request)
            .then(networkResponse => {
              if (networkResponse && networkResponse.status === 200) {
                const responseToCache = networkResponse.clone();
                caches.open(CACHE_VERSION).then(cache => {
                  cache.put(event.request, responseToCache);
                });
              }
              return networkResponse;
            })
            .catch(() => {/* sin conexión, no pasa nada */});

          // Disparar actualización en background sin bloquear
          event.waitUntil(fetchPromise);
          return cachedResponse;
        }

        // No hay cache → ir a red
        return fetch(event.request)
          .then(networkResponse => {
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type === 'opaque') {
              return networkResponse;
            }
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_VERSION).then(cache => {
              cache.put(event.request, responseToCache);
            });
            return networkResponse;
          })
          .catch(() => {
            // Sin conexión y sin cache: mostrar página de error
            return new Response(
              '<html><body style="background:#080808;color:#C9A84C;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center"><div><h1>ZAYRA</h1><p>No internet connection.<br>Open the catalog once online to enable offline access.</p></div></body></html>',
              { headers: { 'Content-Type': 'text/html' } }
            );
          });
      })
  );
});

// ─── MESSAGE: forzar actualización desde la app ──────────────────────────────
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
