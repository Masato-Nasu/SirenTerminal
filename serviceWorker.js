const CACHE_NAME='siren-terminal-v1';
const FILES_TO_CACHE=['./index.html','./style.css','./script.js','./manifest.json','./gpt4all/gpt4all.js'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(FILES_TO_CACHE)));});
self.addEventListener('fetch',event=>{event.respondWith(caches.match(event.request).then(resp=>resp||fetch(event.request)));});