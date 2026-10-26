// Sandbox Realms service worker: precache the shell, cache-first for hashed assets,
// network-first for navigations with an offline fallback. It never calls skipWaiting,
// so a new build waits for the next cold start (17 section 10: never hot-swap mid-session).
const CACHE = 'sr-shell-v2';
// BASE is the deploy path ('/' locally, '/sandbox-realms/' on GitHub Pages), read from the worker scope.
const BASE = new URL(self.registration.scope).pathname;
const SHELL = ['', 'index.html', 'manifest.webmanifest', 'icon.svg', 'icon-maskable-192.png', 'icon-maskable-512.png'].map((p) => BASE + p);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(BASE + 'index.html', copy));
          }
          return response;
        })
        .catch(() => caches.match(BASE + 'index.html').then((hit) => hit ?? Response.error())),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((response) => {
        if (response.ok && url.pathname.startsWith(BASE + 'assets/')) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
