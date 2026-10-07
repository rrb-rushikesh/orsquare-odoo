/*
 * OR² offline app-shell service worker.
 *
 * Strategy:
 *  - /assets/*  (hash-immutable Vite bundles + self-hosted fonts): cache-first.
 *  - Navigations (HTML): network-first; fall back to the cached shell so the
 *    register opens with no connectivity. Business data offline behaviour is
 *    handled by Dexie + lib/sync.ts, never here.
 *  - /api/*, /admin/*, /static/*, /healthz: passed through untouched.
 *  - Cross-origin requests: never intercepted.
 */
const VERSION = 'orsquare-shell-v5';
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/favicon-16.png',
  '/favicon-32.png',
  '/favicon-48.png',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const path = url.pathname;
  if (
    path.startsWith('/api/') ||
    path.startsWith('/admin/') ||
    path.startsWith('/static/') ||
    path === '/healthz'
  ) {
    return; // always live network; the app handles its own offline queue
  }

  // Hash-immutable build output: cache-first forever.
  if (path.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(VERSION).then((cache) => cache.put(req, copy));
            }
            return res;
          })
      )
    );
    return;
  }

  // HTML navigations: network-first, cached shell as the offline fallback.
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((cache) => cache.put('/index.html', copy));
          }
          return res;
        })
        .catch(() =>
          caches.match('/index.html').then((hit) => hit || caches.match('/'))
        )
    );
    return;
  }
});
