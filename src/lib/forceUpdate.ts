/**
 * Força a aplicação a buscar a versão mais recente publicada:
 * 1. Remove qualquer service worker antigo (causa comum de tela branca)
 * 2. Limpa os caches do navegador (Cache Storage)
 * 3. Recarrega a página sem cache
 */
export async function forceAppUpdate(): Promise<void> {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.allSettled(regs.map((r) => r.unregister()));
    }
  } catch {
    /* ignore */
  }

  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.allSettled(keys.map((k) => caches.delete(k)));
    }
  } catch {
    /* ignore */
  }

  // Cache-buster garante HTML novo mesmo em proxies agressivos
  const url = new URL(window.location.href);
  url.searchParams.set("_v", Date.now().toString());
  window.location.replace(url.toString());
}
