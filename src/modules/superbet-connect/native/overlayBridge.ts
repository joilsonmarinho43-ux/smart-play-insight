// Bridge tipada para o plugin Capacitor SuperbetOverlay (apenas Android).
// Em web/iOS, todas as funções retornam estados "indisponível" sem quebrar.

import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface OverlayStatus {
  overlayPermission: boolean;
  projectionReady: boolean;
  overlayRunning: boolean;
  platform: 'android' | 'ios' | 'web';
  sdk?: number;
}

export interface CapturedPayload {
  imageBase64: string;
  timestamp: number;
}

export interface OverlayErrorPayload {
  code: string;
  message: string;
}

export interface OverlayStatePayload {
  running: boolean;
}

interface SuperbetOverlayPlugin {
  getStatus(): Promise<OverlayStatus>;
  requestOverlayPermission(): Promise<{ granted: boolean; opened?: boolean }>;
  requestProjectionPermission(): Promise<{ opened: boolean }>;
  startOverlay(): Promise<void>;
  stopOverlay(): Promise<void>;
  captureNow(): Promise<void>;
  addListener(
    event: 'overlayCaptured',
    cb: (p: CapturedPayload) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: 'overlayError',
    cb: (p: OverlayErrorPayload) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: 'overlayState',
    cb: (p: OverlayStatePayload) => void,
  ): Promise<PluginListenerHandle>;
}

export const isOverlaySupported = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

const Native = registerPlugin<SuperbetOverlayPlugin>('SuperbetOverlay');

const UNSUPPORTED_STATUS: OverlayStatus = {
  overlayPermission: false,
  projectionReady: false,
  overlayRunning: false,
  platform: (Capacitor.getPlatform() as OverlayStatus['platform']) ?? 'web',
};

export const OverlayBridge = {
  supported: isOverlaySupported(),

  async getStatus(): Promise<OverlayStatus> {
    if (!isOverlaySupported()) return UNSUPPORTED_STATUS;
    try { return await Native.getStatus(); }
    catch { return UNSUPPORTED_STATUS; }
  },

  async requestOverlayPermission() {
    if (!isOverlaySupported()) return { granted: false };
    return Native.requestOverlayPermission();
  },

  async requestProjectionPermission() {
    if (!isOverlaySupported()) return { opened: false };
    return Native.requestProjectionPermission();
  },

  async start() {
    if (!isOverlaySupported()) throw new Error('overlay_unsupported_platform');
    return Native.startOverlay();
  },

  async stop() {
    if (!isOverlaySupported()) return;
    return Native.stopOverlay();
  },

  async captureNow() {
    if (!isOverlaySupported()) throw new Error('overlay_unsupported_platform');
    return Native.captureNow();
  },

  onCaptured(cb: (p: CapturedPayload) => void): Promise<PluginListenerHandle> | null {
    if (!isOverlaySupported()) return null;
    return Native.addListener('overlayCaptured', cb);
  },

  onError(cb: (p: OverlayErrorPayload) => void): Promise<PluginListenerHandle> | null {
    if (!isOverlaySupported()) return null;
    return Native.addListener('overlayError', cb);
  },

  onState(cb: (p: OverlayStatePayload) => void): Promise<PluginListenerHandle> | null {
    if (!isOverlaySupported()) return null;
    return Native.addListener('overlayState', cb);
  },
};
