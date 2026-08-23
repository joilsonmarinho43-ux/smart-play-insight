import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
// Registra as fontes do Data Provider Unificado (Pré-Jogo)
import "./services/dataProvider/sources";

// PWA cleanup: service workers antigos serviam HTML/assets desatualizados (tela branca).
// Agora nenhum SW é registrado; qualquer registro remanescente é removido.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((regs) => regs.forEach((r) => r.unregister()))
    .catch(() => {});
  if ("caches" in window) {
    caches
      .keys()
      .then((keys) =>
        keys.filter((k) => k.startsWith("nexus-33-")).forEach((k) => caches.delete(k))
      )
      .catch(() => {});
  }
}

createRoot(document.getElementById("root")!).render(<App />);
