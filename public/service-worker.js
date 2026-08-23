// Kill-switch worker: remove registros antigos que serviam HTML/assets desatualizados
// (causa de tela branca após deploys). Mantém apenas caches desta própria registration.
function isAppCache(name) {
  return /^nexus-33-/.test(name) || /(^|-)precache-v\d+-|(^|-)runtime-/.test(name);
}

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      try {
        const names = await caches.keys();
        await Promise.allSettled(names.filter(isAppCache).map((n) => caches.delete(n)));
        await self.clients.claim();
        const clients = await self.clients.matchAll({ type: "window" });
        await Promise.allSettled(clients.map((c) => c.navigate(c.url)));
      } finally {
        await self.registration.unregister();
      }
    })()
  )
);
