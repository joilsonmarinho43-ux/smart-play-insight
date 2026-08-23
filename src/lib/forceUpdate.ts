/**
 * Força a aplicação a buscar a versão mais recente publicada:
 * 1. Limpa os caches do navegador (Cache Storage)
 * 2. Atualiza / re-registra o service worker
 * 3. Recarrega a página sem cache
 */
export async function forceAppUpdate(): Promise<void> {
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.allSettled(keys.map((k) => caches.delete(k)));
    }
  } catch {
    /* ignore */
  }

  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.allSettled(regs.map((r) => r.update().catch(() => r.unregister())));
      if (regs.length === 0) {
        await navigator.serviceWorker.register("/service-worker.js").catch(() => undefined);
      }
      // Pede ativação imediata da nova versão, se houver
      regs.forEach((r) => r.waiting?.postMessage({ type: "SKIP_WAITING" }));
    }
  } catch {
    /* ignore */
  }

  // Cache-buster garante HTML novo mesmo em proxies agressivos
  const url = new URL(window.location.href);
  url.searchParams.set("_v", Date.now().toString());
  window.location.replace(url.toString());
}
