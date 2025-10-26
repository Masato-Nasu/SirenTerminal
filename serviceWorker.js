// v19.9 network-first (same-origin)
const CACHE_NAME = 'siren-terminal-v19-9';
const STATIC = ['./','./index.html','./style.css','./script.js','./manifest.json','./assets/icon-192.png','./assets/icon-512.png'];
self.addEventListener('install', e=>{ self.skipWaiting(); e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(STATIC))); });
self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(k=>k!==CACHE_NAME?caches.delete(k):Promise.resolve()))));
  self.clients.claim();
});
self.addEventListener('fetch', e=>{
  const u = new URL(e.request.url);
  if (u.origin !== location.origin){
    e.respondWith(fetch(e.request).catch(()=>caches.match('./index.html')));
    return;
  }
  e.respondWith(
    fetch(e.request).then(res=>{ const copy=res.clone(); caches.open(CACHE_NAME).then(c=>c.put(e.request, copy)); return res; })
    .catch(()=>caches.match(e.request))
  );
});
