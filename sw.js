const VERSION='pwa-v2.1';
const CACHE='depthlogger-'+VERSION;
const ASSETS=['./','./index_pwa_v2.html','./manifest.json','./icon-192.png','./icon-512.png','./brownfield_logo.png'];

self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))); self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(k=>k===CACHE?null:caches.delete(k))))); self.clients.claim();});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  e.respondWith((async()=>{
    const cached = await caches.match(e.request);
    if(cached){ e.waitUntil(fetch(e.request).then(r=>caches.open(CACHE).then(c=>c.put(e.request,r.clone()))).catch(()=>{})); return cached; }
    try{ const fresh = await fetch(e.request); const c = await caches.open(CACHE); c.put(e.request,fresh.clone()); return fresh; }
    catch(err){ if(e.request.headers.get('accept')?.includes('text/html')) return caches.match('./index_pwa_v2.html'); throw err; }
  })());
});
});
