import { useCallback, useEffect, useState } from "react";
import { DEFAULT_SETTINGS, type AutoPilotSettings } from "../config";

const STORAGE_KEY = "autopilot.settings.v1";

export function useAutoPilotSettings() {
  const [settings, setSettings] = useState<AutoPilotSettings>(() => {
    if (typeof window === "undefined") return DEFAULT_SETTINGS;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return DEFAULT_SETTINGS;
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* ignore quota errors */
    }
  }, [settings]);

  const update = useCallback(<K extends keyof AutoPilotSettings>(key: K, value: AutoPilotSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  const reset = useCallback(() => setSettings(DEFAULT_SETTINGS), []);

  const toggleKillSwitch = useCallback(() => {
    setSettings((prev) => ({ ...prev, killSwitch: !prev.killSwitch }));
  }, []);

  return { settings, update, reset, toggleKillSwitch };
}
