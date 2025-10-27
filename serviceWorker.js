// v21 cache bump & network-first for external APIs
const CACHE_NAME = 'siren-terminal-v21';
const FILES_TO_CACHE = [
  './index.html','./style.css','./script.js','./manifest.json','./icon-192.png','./icon-512.png'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(FILES_TO_CACHE)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => (k !== CACHE_NAME ? caches.delete(k) : null))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // External requests → network-first, fall back to cache or index
  if (url.origin !== location.origin) {
    e.respondWith(
      fetch(req).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // App shell → cache-first
  e.respondWith(
    caches.match(req).then(r => r || fetch(req))
  );
});
