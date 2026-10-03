// Retained temporarily so browsers with an older installed worker can remove it.
self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith("lvfr-pwa-shell-")).map(name => caches.delete(name)));
    await self.registration.unregister();
  })());
});
