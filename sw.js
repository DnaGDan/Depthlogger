const VERSION='pwa-v4.14.1';
const CACHE='depthlogger-'+VERSION;
// update to new html name
const ASSETS=['./','./index_pwa_v4.html','./manifest.json','./icon-192.png','./icon-512.png','./exceljs.min.js','./jszip.min.js','./brownfield-logo-data.js?v=4.14.1','./excel-report-v4.js?v=4.14.1','./EXCELJS-LICENSE.txt','./JSZIP-LICENSE.md'];

self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))); self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(k=>k===CACHE?null:caches.delete(k))))); self.clients.claim();});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  e.respondWith((async()=>{
    const cached = await caches.match(e.request);
    if(cached){ e.waitUntil(fetch(e.request).then(r=>caches.open(CACHE).then(c=>c.put(e.request,r.clone()))).catch(()=>{})); return cached; }
    try{ const fresh = await fetch(e.request); const c = await caches.open(CACHE); c.put(e.request,fresh.clone()); return fresh; }
    catch(err){ if(e.request.headers.get('accept')?.includes('text/html')) return caches.match('./index_pwa_v4.html'); throw err; }
  })());
});
