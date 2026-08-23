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
      // Procura nova versão assim que abre e a cada 60s
      reg.update().catch(() => {});
      setInterval(() => reg.update().catch(() => {}), 60_000);

      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            newWorker.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });
    }).catch(() => {});

    // Recarrega uma única vez quando o novo SW assume
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });

  });
} else if (isInIframe || isPreview) {

  navigator.serviceWorker?.getRegistrations().then((regs) =>
    regs.forEach((r) => r.unregister())
  );
}

createRoot(document.getElementById("root")!).render(<App />);
