const CACHE = 'budget-tool-web-v94';
const ASSETS = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest', './icons/money-bags.svg', './fonts/fonts.css', './fonts/roboto-variable.woff2', './fonts/roboto-variable-ext.woff2', './fonts/roboto-flex-variable.woff2', './fonts/roboto-flex-variable-ext.woff2'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(caches.match(event.request).then(cached => {
    if (cached) return cached;
    // Only cache and serve same-origin assets. Cross-origin requests (for
    // example third-party fonts) pass straight through to the network and are
    // never stored in this cache.
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return fetch(event.request);
    return fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match('./index.html'));
  }));
});
