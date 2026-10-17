// Rondel's service worker: keeps the app's own files so it opens without a connection and can be installed
// as an app. It never touches meeting data (that is end-to-end encrypted and synced by the app itself) and
// never caches the room server (api/). The build fills in the file list and the version.
const FILES = self.__FILES__;
const CACHE = `rondel-${self.__BUILD__}`;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', ...FILES])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('rondel-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  // The page itself: the newest from the network (it carries the site's settings), else the kept copy.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) caches.open(CACHE).then((c) => c.put('./', res.clone()));
      return res;
    }).catch(() => caches.match('./')));
    return;
  }
  // Built files never change under the same name; anything else (icons, templates) is refreshed in the background.
  e.respondWith(caches.match(req).then((hit) => {
    const net = fetch(req).then((res) => {
      if (res.ok && !url.pathname.includes('/assets/')) caches.open(CACHE).then((c) => c.put(req, res.clone()));
      return res;
    });
    return hit ?? net;
  }));
});
