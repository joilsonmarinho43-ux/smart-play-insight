/**
 * SISTEMA DE CALIBRAGEM AUTOMÁTICA
 * Ajusta pesos de confiança por mercado baseado no histórico de acertos/erros.
 * Fonte: telegram_signals (green/loss) + hybrid_entries (WIN/LOSS).
 * 
 * Multiplier = winRate / expectedWinRate (baseline 0.65)
 * Multiplier é clampado entre 0.5 e 1.15 para evitar over-fitting.
 * 
 * Cache local com TTL de 30 min para não sobrecarregar o banco.
 */

import { supabase } from '@/integrations/supabase/client';

export interface MarketCalibration {
  market: string;
  wins: number;
  losses: number;
  total: number;
  winRate: number;
  multiplier: number;    // applied to confidence
  trend: 'hot' | 'cold' | 'neutral';
}

export interface CalibrationProfile {
  markets: MarketCalibration[];
  updatedAt: number;
  sampleSize: number;
}

const CACHE_KEY = 'calibration_profile';
const CACHE_TTL = 30 * 60 * 1000; // 30 min
const BASELINE_WIN_RATE = 0.65;
const MIN_SAMPLE = 3; // min results to calibrate
const MULTIPLIER_FLOOR = 0.50;
const MULTIPLIER_CEIL = 1.15;

// ── Normalise market name to a canonical key ──
function normaliseMarket(raw: string): string {
  const s = raw.replace(/[⚽🏆🎯📐🟨⚡️]/g, '').trim();
  if (/over\s*0\.?5\s*(gol|go)/i.test(s)) return 'Over 0.5 Gols';
  if (/over\s*1\.?5/i.test(s)) return 'Over 1.5 Gols';
  if (/over\s*2\.?5/i.test(s)) return 'Over 2.5 Gols';
  if (/over\s*3\.?5/i.test(s)) return 'Over 3.5 Gols';
  if (/ambas/i.test(s)) return 'Ambas Marcam';
  if (/pr[oó]ximo\s*gol/i.test(s)) return 'Próximo Gol';
  if (/vit[oó]ria/i.test(s)) return 'Vitória';
  if (/chance\s*dupla/i.test(s)) return 'Chance Dupla';
  if (/under.*gol/i.test(s) || /under\s*\d/i.test(s)) return 'Under Gols';
  if (/canto|corner/i.test(s)) return 'Cantos';
  if (/cart[aã]o|card/i.test(s)) return 'Cartões';
  if (/handicap/i.test(s)) return 'Handicap';
  return s;
}

// ── Fetch results from both tables ──
async function fetchHistoricalResults(): Promise<{ market: string; won: boolean }[]> {
  const results: { market: string; won: boolean }[] = [];

  // telegram_signals (green = win, loss = loss)
  const { data: signals } = await supabase
    .from('telegram_signals')
    .select('market, status')
    .in('status', ['green', 'loss']);

  if (signals) {
    for (const s of signals) {
      results.push({ market: normaliseMarket(s.market), won: s.status === 'green' });
    }
  }

  // hybrid_entries (WIN/LOSS)
  const { data: entries } = await supabase
    .from('hybrid_entries')
    .select('market, result')
    .in('result', ['WIN', 'LOSS']);

  if (entries) {
    for (const e of entries) {
      results.push({ market: normaliseMarket(e.market), won: e.result === 'WIN' });
    }
  }

  return results;
}

// ── Recent-bias weighting: last N results count more ──
function computeCalibration(results: { market: string; won: boolean }[]): MarketCalibration[] {
  const grouped: Record<string, boolean[]> = {};
  for (const r of results) {
    if (!grouped[r.market]) grouped[r.market] = [];
    grouped[r.market].push(r.won);
  }

  const calibrations: MarketCalibration[] = [];

  for (const [market, outcomes] of Object.entries(grouped)) {
    const total = outcomes.length;
    if (total < MIN_SAMPLE) continue;

    // Weight recent results more (last 5 = 2x weight)
    let weightedWins = 0;
    let weightedTotal = 0;
    for (let i = 0; i < outcomes.length; i++) {
      const recency = i >= outcomes.length - 5 ? 2 : 1;
      weightedWins += outcomes[i] ? recency : 0;
      weightedTotal += recency;
    }

    const winRate = weightedWins / weightedTotal;
    const rawMultiplier = winRate / BASELINE_WIN_RATE;
    const multiplier = Math.round(Math.min(MULTIPLIER_CEIL, Math.max(MULTIPLIER_FLOOR, rawMultiplier)) * 100) / 100;

    const wins = outcomes.filter(Boolean).length;
    const losses = total - wins;

    const trend: 'hot' | 'cold' | 'neutral' =
      multiplier >= 1.05 ? 'hot' : multiplier <= 0.75 ? 'cold' : 'neutral';

    calibrations.push({ market, wins, losses, total, winRate: Math.round(winRate * 100), multiplier, trend });
  }

  return calibrations.sort((a, b) => b.total - a.total);
}

// ── Public API ──

let cachedProfile: CalibrationProfile | null = null;

export async function getCalibrationProfile(forceRefresh = false): Promise<CalibrationProfile> {
  const now = Date.now();

  // Try memory cache
  if (!forceRefresh && cachedProfile && (now - cachedProfile.updatedAt) < CACHE_TTL) {
    return cachedProfile;
  }

  // Try localStorage cache
  if (!forceRefresh) {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const parsed: CalibrationProfile = JSON.parse(raw);
        if ((now - parsed.updatedAt) < CACHE_TTL) {
          cachedProfile = parsed;
          return parsed;
        }
      }
    } catch { /* ignore */ }
  }

  // Fetch fresh
  const results = await fetchHistoricalResults();
  const markets = computeCalibration(results);
  const profile: CalibrationProfile = { markets, updatedAt: now, sampleSize: results.length };

  cachedProfile = profile;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(profile));
  } catch { /* ignore */ }

  return profile;
}

/**
 * Retorna o multiplicador de confiança para um mercado.
 * Se não há dados suficientes, retorna 1.0 (sem ajuste).
 */
export function getMarketMultiplier(profile: CalibrationProfile, marketName: string): number {
  const key = normaliseMarket(marketName);
  const cal = profile.markets.find(m => m.market === key);
  return cal?.multiplier ?? 1.0;
}

/**
 * Aplica calibragem a um valor de confiança.
 */
export function calibrateConfidence(profile: CalibrationProfile, marketName: string, rawConfidence: number): number {
  const mult = getMarketMultiplier(profile, marketName);
  return Math.round(Math.min(95, Math.max(0, rawConfidence * mult)));
}
