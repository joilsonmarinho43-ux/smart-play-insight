const CACHE_NAME = "nexus-33-v3";
const PRECACHE_URLS = ["/", "/index.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  // Force the new SW to take over immediately on install
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop ALL old caches (any name != current)
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      );
      // Take control of all open clients without requiring a reload
      await self.clients.claim();
      // Notify all clients so they can reload to pick up the new shell
      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients) {
        client.postMessage({ type: "SW_UPDATED", cache: CACHE_NAME });
      }
    })()
  );
});

// Allow page to trigger immediate activation if needed
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.url.includes("/~oauth")) return;
  if (req.method !== "GET") return;

  // Never cache API/Supabase calls — must always be fresh
  if (
    req.url.includes("supabase.co") ||
    req.url.includes("/functions/") ||
    req.url.includes("/rest/") ||
    req.url.includes("/auth/")
  ) {
    return;
  }

  // Network-first for HTML navigations (so deploys are picked up immediately)
  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    event.respondWith(
      fetch(req)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          return response;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("/index.html")))
    );
    return;
  }

  // Stale-while-revalidate for static assets
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          return response;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
