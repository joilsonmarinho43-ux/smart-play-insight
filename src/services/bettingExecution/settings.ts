import { useCallback, useEffect, useState } from "react";
import type { ExecutionLog, ExecutionSettings } from "./types";

const SETTINGS_KEY = "nexus33.bettingExecution.settings.v1";
const LOGS_KEY = "nexus33.bettingExecution.logs.v1";

export const DEFAULT_SETTINGS: ExecutionSettings = {
  enabled: false,
  mode: "simulation",
  provider: "mock",
  stakeDefault: 5,
  stakeMax: 20,
  exposureMax: 100,
  oddMin: 1.4,
  oddMax: 3.0,
  maxEntriesPerDay: 5,
  stopLossDaily: 50,
  killSwitch: false,
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...(fallback as object), ...JSON.parse(raw) } as T : fallback;
  } catch {
    return fallback;
  }
}

export function useExecutionSettings() {
  const [settings, setSettings] = useState<ExecutionSettings>(() =>
    read(SETTINGS_KEY, DEFAULT_SETTINGS),
  );

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  const update = useCallback(
    <K extends keyof ExecutionSettings>(key: K, value: ExecutionSettings[K]) =>
      setSettings((p) => ({ ...p, [key]: value })),
    [],
  );

  const reset = useCallback(() => setSettings(DEFAULT_SETTINGS), []);
  const toggleKillSwitch = useCallback(
    () => setSettings((p) => ({ ...p, killSwitch: !p.killSwitch })),
    [],
  );

  return { settings, update, reset, toggleKillSwitch };
}

export function loadLogs(): ExecutionLog[] {
  try {
    return JSON.parse(localStorage.getItem(LOGS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function saveLog(entry: ExecutionLog) {
  const next = [entry, ...loadLogs()].slice(0, 300);
  localStorage.setItem(LOGS_KEY, JSON.stringify(next));
  return next;
}

export function clearLogs() {
  localStorage.removeItem(LOGS_KEY);
}
