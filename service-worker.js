const CACHE_NAME = 'mol-craft-shell-v2';
const APP_SHELL = [
  './', './index.html', './offline.html', './manifest.webmanifest', './icons/mol-craft-icon.svg',
  './src/app.js', './src/io.js', './src/uff.js', './src/model.js', './src/snap.js', './src/params.js',
  './src/presets.js', './src/geom.js', './src/share.js', './src/sketch2d.js', './src/catalog.js',
  './src/catalog.css', './src/learning.js', './src/menu-select.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
      return response;
    }).catch(() => caches.match('./index.html').then((response) => response || caches.match('./offline.html'))));
    return;
  }
  // HTML과 ES 모듈은 새 배포를 우선해 오래된 UI가 캐시에 고정되지 않게 한다.
  // 연결이 끊긴 경우에만 마지막으로 정상 응답한 셸을 사용한다.
  if (url.origin === self.location.origin && (url.pathname.endsWith('.html') || url.pathname.includes('/src/'))) {
    event.respondWith(fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match(event.request).then((response) => response || caches.match('./offline.html'))));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    if (url.origin === self.location.origin) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
    }
    return response;
  })));
});
