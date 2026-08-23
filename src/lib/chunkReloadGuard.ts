/**
 * Proteção contra bundles antigos após um novo deploy.
 *
 * Quando o navegador mantém uma aba aberta e o servidor publica um novo build,
 * os chunks com hash antigo deixam de existir (HTTP 404) e o Vite dispara
 * `vite:preloadError` (ou um erro de "Failed to fetch dynamically imported module").
 * Nesses casos forçamos UMA recarga completa da página, com trava para evitar loop.
 */

const RELOAD_FLAG = "nexus33:chunk-reload-at";
const RELOAD_COOLDOWN_MS = 60_000;

function isChunkLoadError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("failed to fetch dynamically imported module") ||
    m.includes("error loading dynamically imported module") ||
    m.includes("importing a module script failed") ||
    m.includes("unable to preload css") ||
    (m.includes("loading chunk") && m.includes("failed"))
  );
}

function reloadOnce(reason: string) {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(RELOAD_FLAG) || 0);
  } catch {
    /* storage indisponível */
  }

  // Trava: só recarrega uma vez por janela de tempo (evita loop infinito)
  if (last && Date.now() - last < RELOAD_COOLDOWN_MS) {
    console.warn("[chunk-guard] nova versão detectada, reload já efetuado:", reason);
    return;
  }

  try {
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  } catch {
    /* storage indisponível */
  }

  console.warn("[chunk-guard] bundle desatualizado detectado, recarregando:", reason);

  // Cache-buster apenas no reload (não interfere em rotas/auth: path e hash preservados)
  const url = new URL(window.location.href);
  url.searchParams.set("_v", Date.now().toString(36));
  window.location.replace(url.toString());
}

export function installChunkReloadGuard() {
  if (typeof window === "undefined") return;

  // 1. Evento nativo do Vite para falha de preload de chunk
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    reloadOnce("vite:preloadError");
  });

  // 2. Import dinâmico que falha em runtime (rejeição não tratada)
  window.addEventListener("unhandledrejection", (event) => {
    const msg = String((event.reason as Error)?.message ?? event.reason ?? "");
    if (isChunkLoadError(msg)) reloadOnce("unhandledrejection");
  });

  // 3. Erro de carregamento de <script type="module"> antigo
  window.addEventListener(
    "error",
    (event) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "SCRIPT" || target.tagName === "LINK")) {
        const src =
          (target as HTMLScriptElement).src || (target as HTMLLinkElement).href || "";
        if (src.includes("/assets/")) reloadOnce(`asset 404: ${src}`);
        return;
      }
      if (isChunkLoadError(String(event.message || ""))) reloadOnce("window.error");
    },
    true,
  );
}
