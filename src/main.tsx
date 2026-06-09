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
      // Listen for updates and trigger immediate activation
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

    // Reload once when the new SW takes control (after activate)
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });

    // React to SW broadcast messages
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "SW_UPDATED") {
        // Already handled by controllerchange in most cases; no-op fallback
      }
    });
  });
} else if (isInIframe || isPreview) {
  navigator.serviceWorker?.getRegistrations().then((regs) =>
    regs.forEach((r) => r.unregister())
  );
}

createRoot(document.getElementById("root")!).render(<App />);
