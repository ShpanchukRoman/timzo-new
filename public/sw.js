// Never cache authenticated pages, shared links, or API responses.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate' || event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).catch(() => new Response(`<!doctype html><html lang="uk"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#203d32"><title>timzo — немає з’єднання</title><body style="margin:0;padding:32px;background:#f3f5ef;color:#203d32;font-family:sans-serif"><main style="max-width:440px;margin:20vh auto"><h1>timzo</h1><h2>Потрібне з’єднання</h2><p>Підключіться до інтернету, щоб відкрити графік. Ця сторінка не зберігає зміни.</p><button onclick="location.reload()" style="background:#285e49;color:white;border:0;border-radius:8px;padding:14px 24px;font:inherit">Спробувати знову</button></main></body></html>`, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })));
});
