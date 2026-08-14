/**
 * SayIn Service Worker - 离线缓存
 * @author  joyapple
 * @license Apache-2.0
 */
const CACHE = 'sayit-v1';
const ASSETS = ['/', '/index.html', '/desk.html', '/manifest.json', '/app-icon.svg'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // WebSocket 不拦截
  const url = new URL(req.url);
  if (url.protocol === 'ws:' || url.protocol === 'wss:') return;
  // API 请求不走缓存
  if (url.pathname.startsWith('/ip') || url.pathname.startsWith('/apps') ||
      url.pathname.startsWith('/settings') || url.pathname.startsWith('/history') ||
      url.pathname.startsWith('/app/') || url.pathname.startsWith('/paste') ||
      url.pathname.startsWith('/cert')) {
    return;
  }
  // 静态资源：缓存优先，网络兜底
  e.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(res => {
      if (res.ok && (res.type === 'basic' || res.type === 'cors')) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(req, clone)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match('/index.html')))
  );
});
