// v19.8 network-first (same-origin) + small offline cache
const CACHE_NAME = 'siren-terminal-v19-8';
const STATIC = ['./','./index.html','./style.css','./script.js','./manifest.json','./assets/icon-192.png','./assets/icon-512.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(STATIC)));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => k !== CACHE_NAME ? caches.delete(k) : Promise.resolve())))
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) {
    // external => network, fallback to cached index for app shell
    e.respondWith(fetch(e.request).catch(() => caches.match('./index.html')));
    return;
  }
  // same-origin => network-first, then cache
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request))
  );
});
