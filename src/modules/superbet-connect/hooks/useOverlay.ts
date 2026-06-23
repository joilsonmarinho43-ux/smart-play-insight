import { useCallback, useEffect, useRef, useState } from 'react';
import type { PluginListenerHandle } from '@capacitor/core';
import {
  OverlayBridge,
  isOverlaySupported,
  type OverlayStatus,
  type CapturedPayload,
  type OverlayErrorPayload,
} from '../native/overlayBridge';

interface UseOverlayResult {
  supported: boolean;
  status: OverlayStatus | null;
  refreshStatus: () => Promise<void>;
  requestOverlay: () => Promise<void>;
  requestProjection: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  captureNow: () => Promise<void>;
  lastCapture: CapturedPayload | null;
  lastError: OverlayErrorPayload | null;
  busy: boolean;
}

export function useOverlay(
  onCapture?: (p: CapturedPayload) => void,
): UseOverlayResult {
  const [status, setStatus] = useState<OverlayStatus | null>(null);
  const [lastCapture, setLastCapture] = useState<CapturedPayload | null>(null);
  const [lastError, setLastError] = useState<OverlayErrorPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const onCaptureRef = useRef(onCapture);
  onCaptureRef.current = onCapture;

  const refreshStatus = useCallback(async () => {
    const s = await OverlayBridge.getStatus();
    setStatus(s);
  }, []);

  useEffect(() => { void refreshStatus(); }, [refreshStatus]);

  useEffect(() => {
    if (!isOverlaySupported()) return;
    const handles: Promise<PluginListenerHandle>[] = [];
    const capH = OverlayBridge.onCaptured((p) => {
      setLastCapture(p);
      onCaptureRef.current?.(p);
    });
    const errH = OverlayBridge.onError((p) => setLastError(p));
    const stateH = OverlayBridge.onState(() => void refreshStatus());
    if (capH) handles.push(capH);
    if (errH) handles.push(errH);
    if (stateH) handles.push(stateH);

    // Reavalia status quando o app volta do background
    const onVis = () => { if (document.visibilityState === 'visible') void refreshStatus(); };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      handles.forEach((h) => { void h.then((x) => x.remove()); });
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [refreshStatus]);

  const wrap = <T,>(fn: () => Promise<T>) => async () => {
    setBusy(true);
    try { return await fn(); }
    finally { setBusy(false); await refreshStatus(); }
  };

  return {
    supported: isOverlaySupported(),
    status,
    refreshStatus,
    requestOverlay: wrap(() => OverlayBridge.requestOverlayPermission().then()),
    requestProjection: wrap(() => OverlayBridge.requestProjectionPermission().then()),
    start: wrap(() => OverlayBridge.start()),
    stop: wrap(() => OverlayBridge.stop()),
    captureNow: wrap(() => OverlayBridge.captureNow()),
    lastCapture,
    lastError,
    busy,
  };
}
