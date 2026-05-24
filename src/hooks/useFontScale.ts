import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'nexus33-font-scale';
const SCALES = [0.875, 1, 1.125, 1.25, 1.375] as const;
type Scale = (typeof SCALES)[number];

function getStoredScale(): Scale {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = parseFloat(raw);
      if (SCALES.includes(parsed as Scale)) return parsed as Scale;
    }
  } catch { /* noop */ }
  return 1;
}

export function useFontScale() {
  const [scale, setScaleState] = useState<Scale>(getStoredScale);

  const apply = useCallback((s: Scale) => {
    const html = document.documentElement;
    if (s === 1) {
      html.style.removeProperty('font-size');
    } else {
      html.style.fontSize = `${s * 100}%`;
    }
  }, []);

  useEffect(() => {
    apply(scale);
  }, [scale, apply]);

  const setScale = useCallback((s: Scale) => {
    setScaleState(s);
    try {
      localStorage.setItem(STORAGE_KEY, String(s));
    } catch { /* noop */ }
  }, []);

  const increase = useCallback(() => {
    const idx = SCALES.indexOf(scale);
    if (idx < SCALES.length - 1) setScale(SCALES[idx + 1]);
  }, [scale, setScale]);

  const decrease = useCallback(() => {
    const idx = SCALES.indexOf(scale);
    if (idx > 0) setScale(SCALES[idx - 1]);
  }, [scale, setScale]);

  const canIncrease = SCALES.indexOf(scale) < SCALES.length - 1;
  const canDecrease = SCALES.indexOf(scale) > 0;

  return { scale, increase, decrease, canIncrease, canDecrease };
}
