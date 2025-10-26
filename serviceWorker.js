// v20.3 cache bump
const CACHE = 'siren-v20-3';
const FILES = ['./index.html','./style.css','./script.js','./manifest.json'];
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.map(k => k !== CACHE ? caches.delete(k) : null)))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) { e.respondWith(fetch(e.request).catch(()=>caches.match('./index.html'))); return; }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});