
const VERSION='v1.7.0'; const CACHE_NAME='depth-logger-'+VERSION;
const ASSETS=['./','./depth_to_water_logger_PWA_IndexedDB_v1.7.0.html','./manifest_depth_logger.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS))); self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(k=>k!==CACHE_NAME?caches.delete(k):Promise.resolve())))); self.clients.claim();});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return; e.respondWith(caches.match(e.request).then(cached=>{const fetchP=fetch(e.request).then(r=>{if(r&&r.status===200){const cp=r.clone(); caches.open(CACHE_NAME).then(c=>c.put(e.request,cp)).catch(()=>{});} return r;}).catch(()=>cached); return cached||fetchP;}));});
