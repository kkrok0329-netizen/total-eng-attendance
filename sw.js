const CACHE='total-eng-google-shell-v2.2.0';
const SHELL=['./offline.html','./style.css','./icons/brand-192.png','./icons/brand-512.png'];
const URLS=SHELL.map(path=>new URL(path,self.location).href);
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(URLS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('total-eng-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(url.origin!==self.location.origin||event.request.method!=='GET')return;
 if(event.request.mode==='navigate'){event.respondWith(fetch(event.request).catch(()=>caches.match(new URL('./offline.html',self.location).href)));return;}
 if(URLS.includes(url.href))event.respondWith(fetch(event.request).catch(()=>caches.match(event.request)));
});
