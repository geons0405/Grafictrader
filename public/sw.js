// Grafictrader service worker: only shows opportunity alerts (Web Push).
// It caches nothing, so the app always loads fresh from the server.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Grafictrader', {
    body: data.body || 'Há uma nova oportunidade a ver.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'grafictrader',
    data: { url: data.url || '/' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = tabs.find(tab => new URL(tab.url).origin === self.location.origin);
    if (open) {
      await open.focus();
      return open.navigate(url).catch(() => {});
    }
    return self.clients.openWindow(url);
  })());
});
