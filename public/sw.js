// myday service worker: shows reminder notifications. A push carries no text; we ask the server what to show.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

async function subId(endpoint) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let n = { title: 'myday', body: 'Open your dashboard', url: '/dashboard', tag: 'myday' };
    try {
      const sub = await self.registration.pushManager.getSubscription();
      if (sub) {
        const r = await fetch('/api/push?action=pending&e=' + (await subId(sub.endpoint)), { cache: 'no-store' });
        if (r.ok) n = Object.assign(n, await r.json());
      }
    } catch (e) { /* show the generic message */ }
    await self.registration.showNotification(n.title, {
      body: n.body, tag: n.tag, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: n.url || '/dashboard' }
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/dashboard';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) { await c.focus(); if ('navigate' in c) { try { await c.navigate(url); } catch (e) {} } return; }
    }
    await self.clients.openWindow(url);
  })());
});
