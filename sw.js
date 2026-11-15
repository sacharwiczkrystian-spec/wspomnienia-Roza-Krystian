const CACHE_NAME="love-story-shell-v3";
const APP_SHELL=["/","/site.webmanifest","/favicon.svg"];

self.addEventListener("install",event=>{
 event.waitUntil(
  caches.open(CACHE_NAME)
   .then(cache=>cache.addAll(APP_SHELL))
   .then(()=>self.skipWaiting())
 );
});

self.addEventListener("activate",event=>{
 event.waitUntil(
  caches.keys()
   .then(keys=>Promise.all(
    keys.filter(key=>key.startsWith("love-story-shell-")&&key!==CACHE_NAME)
      .map(key=>caches.delete(key))
   ))
   .then(()=>self.clients.claim())
 );
});

self.addEventListener("fetch",event=>{
 const request=event.request;
 if(request.method!=="GET")return;
 const url=new URL(request.url);
 if(url.origin!==self.location.origin)return;

 if(request.mode==="navigate"){
  event.respondWith(
   fetch(request).then(response=>{
    // Cache only the homepage. Never store /admin.html or another page as "/".
    if(response&&response.ok&&url.pathname==="/"){
     const copy=response.clone();
     caches.open(CACHE_NAME).then(cache=>cache.put("/",copy));
    }
    return response;
   }).catch(async()=>{
    // Offline fallback is valid only for the homepage itself.
    if(url.pathname==="/"){
     const cached=await caches.match("/");
     if(cached)return cached;
    }
    return new Response(
     "<!doctype html><html lang=\"pl\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>Brak połączenia</title><body style=\"font:16px system-ui;padding:2rem\"><h1>Nie można otworzyć tej strony</h1><p>Sprawdź połączenie z internetem i odśwież stronę.</p></body></html>",
     {status:503,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}}
    );
   })
  );
  return;
 }

 event.respondWith(caches.match(request).then(cached=>cached||fetch(request)));
});
