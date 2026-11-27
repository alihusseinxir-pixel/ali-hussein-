self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => self.clients.claim());
self.addEventListener('fetch', () => {});
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || '10 BUNZ 🍔', {
    body: d.body || '', icon: 'icon-192.png', badge: 'icon-192.png', image: d.image || undefined,
    dir: 'rtl', lang: 'ar', tag: d.tag || 'bunz', renotify: true, data: { url: d.url || './' },
    requireInteraction: !!d.staff, vibrate: d.staff ? [500, 200, 500, 200, 500] : undefined
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    const w = ws.find(c => c.url.split('?')[0] === url.split('?')[0]);
    return w ? w.focus() : self.clients.openWindow(url);
  }));
});
