// v18.8 cache bump
const CACHE_NAME = 'siren-terminal-v18-8';
const FILES_TO_CACHE = [
  './index.html','./style.css','./script.js','./manifest.json'
];
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(FILES_TO_CACHE))); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.map(k => (k !== CACHE_NAME ? caches.delete(k) : null))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (url.origin !== location.origin) { e.respondWith(fetch(req).catch(() => caches.match('./index.html'))); return; }
  e.respondWith(caches.match(req).then(r => r || fetch(req)));
});
