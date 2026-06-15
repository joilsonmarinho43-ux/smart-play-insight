import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
// Registra as fontes do Data Provider Unificado (Pré-Jogo)
import "./services/dataProvider/sources";

// Register service worker only in production and NOT in iframes/preview
const isInIframe = (() => {
  try { return window.self !== window.top; } catch { return true; }
})();
const isPreview =
  window.location.hostname.includes("id-preview--") ||
  window.location.hostname.includes("lovableproject.com");

if ("serviceWorker" in navigator && !isInIframe && !isPreview) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").then((reg) => {
      // Quando houver nova versão, ativa só quando a aba estiver oculta
      // (evita "recarrega sozinho" no meio do uso)
      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            const activateWhenHidden = () => {
              if (document.visibilityState === "hidden") {
                newWorker.postMessage({ type: "SKIP_WAITING" });
                document.removeEventListener("visibilitychange", activateWhenHidden);
              }
            };
            if (document.visibilityState === "hidden") {
              newWorker.postMessage({ type: "SKIP_WAITING" });
            } else {
              document.addEventListener("visibilitychange", activateWhenHidden);
            }
          }
        });
      });
    }).catch(() => {});

    // Só recarrega quando o usuário não está olhando a tela
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloaded) return;
      const tryReload = () => {
        if (document.visibilityState === "hidden") {
          reloaded = true;
          window.location.reload();
        }
      };
      tryReload();
      document.addEventListener("visibilitychange", tryReload);
    });
  });
} else if (isInIframe || isPreview) {

  navigator.serviceWorker?.getRegistrations().then((regs) =>
    regs.forEach((r) => r.unregister())
  );
}

createRoot(document.getElementById("root")!).render(<App />);
