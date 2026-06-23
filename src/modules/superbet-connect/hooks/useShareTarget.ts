import { useEffect } from 'react';

/**
 * Hook que escuta a Web Share Target API (PWA) e o evento custom
 * 'superbet:shared' que o app Android (Capacitor) dispara via plugin
 * de share-target nativo.
 *
 * Na Fase 1 só captura o payload e devolve via callback — o roteamento
 * fica a cargo do componente pai (ShareReceiver).
 */
export interface SharedPayload {
  text?: string;
  url?: string;
  image?: string; // base64 ou blob URL
}

export function useShareTarget(onShared: (payload: SharedPayload) => void) {
  useEffect(() => {
    // 1) Web Share Target via query params (?shared_text=...&shared_url=...)
    const params = new URLSearchParams(window.location.search);
    const t = params.get('shared_text') ?? params.get('text');
    const u = params.get('shared_url') ?? params.get('url');
    if (t || u) {
      onShared({ text: t ?? undefined, url: u ?? undefined });
    }

    // 2) Evento nativo do Capacitor (será disparado pelo plugin Android na Fase 2)
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<SharedPayload>).detail;
      if (detail) onShared(detail);
    };
    window.addEventListener('superbet:shared', handler as EventListener);
    return () => window.removeEventListener('superbet:shared', handler as EventListener);
  }, [onShared]);
}
