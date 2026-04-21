/**
 * ELITE METRICS ENGINE — Métricas de Analista Profissional
 * AP5/AP10, Periculosidade, Gol Iminente, Desvio de Odds
 * COM: Proxy para DA=0, Goal Signal upgrade, conversão corrigida
 */

import type { LiveStats, PISnapshot } from './pressureEngine';

// ═══ DA PROXY: When dangerousAttacks is 0, use shots+corners as proxy ═══
function getEffectiveDA(stats: LiveStats | null): number {
  if (!stats) return 0;
  if (stats.dangerousAttacks > 0) return stats.dangerousAttacks;
  // Fallback proxy: shots * 1.5 + corners * 2
  return (stats.totalShots || 0) * 1.5 + (stats.corners || 0) * 2;
}

// ═══ NORMALIZAÇÃO DE PRESSÃO (0-100) ═══
export function normalizePressure(rawPI: number): number {
  const normalized = (rawPI / (rawPI + 40)) * 100;
  return Math.round(Math.min(100, Math.max(0, normalized)) * 10) / 10;
}

// ═══ AP5 / AP10 (Attack Pressure em janelas de tempo) ═══
export interface AttackPressureWindows {
  ap5Home: number;
  ap5Away: number;
  ap10Home: number;
  ap10Away: number;
}

export function calculateAPWindows(
  history: PISnapshot[],
  currentMinute: number
): AttackPressureWindows {
  if (history.length === 0) {
    return { ap5Home: 0, ap5Away: 0, ap10Home: 0, ap10Away: 0 };
  }

  const last5 = history.filter(s => s.minute >= currentMinute - 5);
  const last10 = history.filter(s => s.minute >= currentMinute - 10);

  const avg = (arr: PISnapshot[], key: 'homePI' | 'awayPI') =>
    arr.length > 0 ? arr.reduce((sum, s) => sum + s[key], 0) / arr.length : 0;

  return {
    ap5Home: Math.round(normalizePressure(avg(last5, 'homePI')) * 10) / 10,
    ap5Away: Math.round(normalizePressure(avg(last5, 'awayPI')) * 10) / 10,
    ap10Home: Math.round(normalizePressure(avg(last10, 'homePI')) * 10) / 10,
    ap10Away: Math.round(normalizePressure(avg(last10, 'awayPI')) * 10) / 10,
  };
}

// ═══ ÍNDICE DE PERICULOSIDADE (with DA proxy fallback) ═══
export interface PericulosityData {
  home: number;
  away: number;
  homeLabel: string;
  awayLabel: string;
}

export function calculatePericulosity(
  homeStats: LiveStats | null,
  awayStats: LiveStats | null,
  minute: number
): PericulosityData {
  const h = homeStats || { shotsOnGoal: 0, possession: 50, corners: 0, dangerousAttacks: 0, totalShots: 0 };
  const a = awayStats || { shotsOnGoal: 0, possession: 50, corners: 0, dangerousAttacks: 0, totalShots: 0 };

  // Use effective DA (with proxy fallback)
  const hDA = getEffectiveDA(homeStats);
  const aDA = getEffectiveDA(awayStats);

  const homeRaw = (hDA * 3) + (h.corners * 5) + (h.shotsOnGoal * 10);
  const awayRaw = (aDA * 3) + (a.corners * 5) + (a.shotsOnGoal * 10);

  const normalize = (v: number) => Math.round(Math.min(100, (v / (v + 50)) * 100) * 10) / 10;

  const homeNorm = normalize(homeRaw);
  const awayNorm = normalize(awayRaw);

  const getLabel = (v: number) =>
    v >= 70 ? '🔴 GOL IMINENTE' : v >= 50 ? '🟠 ALTO' : v >= 30 ? '🟡 MODERADO' : '🟢 BAIXO';

  return {
    home: homeNorm,
    away: awayNorm,
    homeLabel: getLabel(homeNorm),
    awayLabel: getLabel(awayNorm),
  };
}

// ═══ GOL IMINENTE UPGRADE ═══
export interface ImminentGoalData {
  score: number;
  isTriggered: boolean;
  reason: string;
}

/**
 * Enhanced goalSignal: triggers if pressure > 70 AND shotsOnGoal >= 4 AND minute >= 20
 */
export function detectImminentGoal(
  stats: LiveStats | null,
  minute: number,
  ap5: number
): ImminentGoalData {
  if (!stats) return { score: 0, isTriggered: false, reason: 'Sem dados' };
  const s = stats;
  const safeMin = Math.max(minute, 1);
  const effectiveDA = getEffectiveDA(stats);

  // Calculate score with proxy DA
  const shotsWeight = Math.min(25, s.shotsOnGoal * 5);
  const dangerousWeight = Math.min(30, (effectiveDA / safeMin) * 35);
  const possessionWeight = s.possession > 60 ? 15 : s.possession > 55 ? 8 : 0;
  const ap5Weight = Math.min(15, ap5 * 0.2);
  const cornersWeight = Math.min(10, s.corners * 2);
  const rhythmBonus = (effectiveDA / safeMin) > 1.0 ? 10 : 0;

  const score = Math.round(Math.min(100, shotsWeight + dangerousWeight + possessionWeight + ap5Weight + cornersWeight + rhythmBonus));

  // Enhanced goal signal: pressure > 70 AND shotsOnGoal >= 4 AND minute >= 20
  const pressureHigh = score > 70;
  const enoughShots = s.shotsOnGoal >= 4;
  const gameInProgress = minute >= 20;
  const hasContinuousPressure = ap5 > 40;
  
  const isTriggered = pressureHigh && enoughShots && gameInProgress && hasContinuousPressure;

  const reasons: string[] = [];
  if (effectiveDA >= 8) reasons.push(`${Math.round(effectiveDA)} at. perigosos`);
  if (s.shotsOnGoal >= 3) reasons.push(`${s.shotsOnGoal} chutes no gol`);
  if ((effectiveDA / safeMin) > 0.8) reasons.push(`ritmo ofensivo crescente`);
  if (s.possession > 60) reasons.push(`${s.possession}% posse`);
  if (ap5 > 60) reasons.push(`AP5 em ${ap5.toFixed(0)}`);

  return {
    score,
    isTriggered,
    reason: reasons.length > 0 ? reasons.join(', ') : 'Sem pressão significativa',
  };
}

// ═══ DESVIO DE ODDS (Poisson em tempo real) ═══
export interface OddsDeviation {
  homeWinPoisson: number;
  drawPoisson: number;
  awayWinPoisson: number;
  homeImpliedOdd: number;
  drawImpliedOdd: number;
  awayImpliedOdd: number;
}

function poissonPMF(lambda: number, k: number): number {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

function factorial(n: number): number {
  if (n <= 1) return 1;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function clampLiveProb(p: number): number {
  return Math.min(99, Math.max(1, p));
}

export function calculateLiveOddsDeviation(
  homeStats: LiveStats | null,
  awayStats: LiveStats | null,
  homeGoals: number,
  awayGoals: number,
  minute: number
): OddsDeviation {
  const h = homeStats || { shotsOnGoal: 0, possession: 50, corners: 0, dangerousAttacks: 0, totalShots: 0 };
  const a = awayStats || { shotsOnGoal: 0, possession: 50, corners: 0, dangerousAttacks: 0, totalShots: 0 };
  const safeMin = Math.max(minute, 1);
  const remainingMin = Math.max(90 - minute, 1);

  const homeConversion = h.totalShots > 0 ? h.shotsOnGoal / h.totalShots : 0.3;
  const awayConversion = a.totalShots > 0 ? a.shotsOnGoal / a.totalShots : 0.3;

  const homeShotsPerMin = h.totalShots / safeMin;
  const awayShotsPerMin = a.totalShots / safeMin;

  // Corrected conversion factor: 0.10 instead of 0.12
  const homeLambdaRemaining = homeShotsPerMin * homeConversion * remainingMin * 0.10;
  const awayLambdaRemaining = awayShotsPerMin * awayConversion * remainingMin * 0.10;

  let homeWin = 0, draw = 0, awayWin = 0;
  const maxGoals = 5;

  for (let hg = 0; hg <= maxGoals; hg++) {
    for (let ag = 0; ag <= maxGoals; ag++) {
      const prob = poissonPMF(homeLambdaRemaining, hg) * poissonPMF(awayLambdaRemaining, ag);
      const finalHome = homeGoals + hg;
      const finalAway = awayGoals + ag;
      if (finalHome > finalAway) homeWin += prob;
      else if (finalHome === finalAway) draw += prob;
      else awayWin += prob;
    }
  }

  const total = homeWin + draw + awayWin || 1;
  let homeP = clampLiveProb(Math.round((homeWin / total) * 100));
  let drawP = clampLiveProb(Math.round((draw / total) * 100));
  let awayP = clampLiveProb(100 - homeP - drawP);
  awayP = clampLiveProb(awayP);

  const margin = 0.92;
  const toOdd = (p: number) => p > 0 ? Math.round((100 / p / margin) * 100) / 100 : 99;

  return {
    homeWinPoisson: homeP,
    drawPoisson: drawP,
    awayWinPoisson: awayP,
    homeImpliedOdd: toOdd(homeP),
    drawImpliedOdd: toOdd(drawP),
    awayImpliedOdd: toOdd(awayP),
  };
}

// ═══ CORNER TIMELINE ═══
export interface CornerPeriod {
  period: string;
  home: number;
  away: number;
}

export function projectCornersByPeriod(
  homeCorners: number,
  awayCorners: number,
  minute: number
): CornerPeriod[] {
  const safeMin = Math.max(minute, 1);
  const homeRate = homeCorners / safeMin;
  const awayRate = awayCorners / safeMin;

  const periods = ['0-15\'', '15-30\'', '30-45\'', '45-60\'', '60-75\'', '75-90\''];
  
  const round1 = (v: number) => Math.round(v * 10) / 10;

  return periods.map((period, i) => {
    const periodEnd = (i + 1) * 15;
    if (periodEnd <= minute) {
      const share = 15 / safeMin;
      return {
        period,
        home: round1(homeCorners * share),
        away: round1(awayCorners * share),
      };
    } else if (i * 15 < minute) {
      const elapsed = minute - i * 15;
      return {
        period,
        home: round1(homeRate * elapsed),
        away: round1(awayRate * elapsed),
      };
    } else {
      return {
        period,
        home: round1(homeRate * 15),
        away: round1(awayRate * 15),
      };
    }
  });
}

// ═══ SMART FILTER: Favorito perdendo com AP alto ═══
export interface SmartFilterResult {
  matchId: string | number;
  tag: string;
  reason: string;
}

export function detectFavoriteLosing(
  matchId: string | number,
  homeName: string,
  awayName: string,
  homeGoals: number,
  awayGoals: number,
  ap5Home: number,
  ap5Away: number,
  homePossession: number,
  awayPossession: number
): SmartFilterResult | null {
  const homeIsFavorite = homePossession > awayPossession;
  const favName = homeIsFavorite ? homeName : awayName;
  const favGoals = homeIsFavorite ? homeGoals : awayGoals;
  const oppGoals = homeIsFavorite ? awayGoals : homeGoals;
  const favAP5 = homeIsFavorite ? ap5Home : ap5Away;

  if (favGoals < oppGoals && favAP5 > 60) {
    return {
      matchId,
      tag: '🔥 FAVORITO PERDENDO',
      reason: `${favName} perdendo ${favGoals}-${oppGoals} mas com AP5 ${favAP5.toFixed(0)} — pressão alta para virar!`,
    };
  }

  return null;
}
