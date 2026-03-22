/**
 * ELITE METRICS ENGINE — Métricas de Analista Profissional
 * AP5/AP10, Periculosidade, Gol Iminente, Desvio de Odds
 */

import type { LiveStats, PISnapshot } from './pressureEngine';

// ═══ NORMALIZAÇÃO DE PRESSÃO (0-100) ═══
export function normalizePressure(rawPI: number): number {
  // PI típico varia de 0~120+. Normaliza via sigmoid suave para 0-100
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

// ═══ ÍNDICE DE PERICULOSIDADE ═══
// Combina: (Ataques Perigosos/min) + (Chutes no Alvo) + (Posse terço final proxy)
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
  const safeMin = Math.max(minute, 1);

  // Posse no terço final estimada: se posse > 55%, terço final ~ posse * 0.6
  const homeFinalThird = h.possession > 50 ? h.possession * 0.6 : h.possession * 0.35;
  const awayFinalThird = a.possession > 50 ? a.possession * 0.6 : a.possession * 0.35;

  const homePeric =
    (h.dangerousAttacks / safeMin) * 30 +
    h.shotsOnGoal * 8 +
    homeFinalThird * 0.4 +
    h.corners * 2;

  const awayPeric =
    (a.dangerousAttacks / safeMin) * 30 +
    a.shotsOnGoal * 8 +
    awayFinalThird * 0.4 +
    a.corners * 2;

  const normalize = (v: number) => Math.round(Math.min(100, (v / (v + 30)) * 100) * 10) / 10;

  const homeNorm = normalize(homePeric);
  const awayNorm = normalize(awayPeric);

  const getLabel = (v: number) =>
    v >= 80 ? '🔴 CRÍTICO' : v >= 60 ? '🟠 ALTO' : v >= 40 ? '🟡 MODERADO' : '🟢 BAIXO';

  return {
    home: homeNorm,
    away: awayNorm,
    homeLabel: getLabel(homeNorm),
    awayLabel: getLabel(awayNorm),
  };
}

// ═══ GOL IMINENTE (Imminent Goal Score) ═══
export interface ImminentGoalData {
  score: number; // 0-100
  isTriggered: boolean; // >= 80
  reason: string;
}

export function detectImminentGoal(
  stats: LiveStats | null,
  minute: number,
  ap5: number
): ImminentGoalData {
  const s = stats || { shotsOnGoal: 0, possession: 50, corners: 0, dangerousAttacks: 0, totalShots: 0 };
  const safeMin = Math.max(minute, 1);

  // Componentes do score
  const shotsWeight = Math.min(30, s.shotsOnGoal * 6);
  const dangerousWeight = Math.min(25, (s.dangerousAttacks / safeMin) * 40);
  const possessionWeight = s.possession > 60 ? 15 : s.possession > 55 ? 10 : 5;
  const ap5Weight = Math.min(20, ap5 * 0.25);
  const cornersWeight = Math.min(10, s.corners * 2);

  const score = Math.round(Math.min(100, shotsWeight + dangerousWeight + possessionWeight + ap5Weight + cornersWeight));
  const isTriggered = score >= 80;

  const reasons: string[] = [];
  if (s.shotsOnGoal >= 3) reasons.push(`${s.shotsOnGoal} chutes no gol`);
  if (s.dangerousAttacks / safeMin > 0.8) reasons.push(`ritmo alto de ataques perigosos`);
  if (s.possession > 60) reasons.push(`${s.possession}% posse`);
  if (ap5 > 60) reasons.push(`AP5 em ${ap5}`);

  return {
    score,
    isTriggered,
    reason: reasons.length > 0 ? reasons.join(', ') : 'Sem pressão significativa',
  };
}

// ═══ DESVIO DE ODDS (Poisson em tempo real vs probabilidade implícita) ═══
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

  // Lambda baseado em ritmo real de finalizações no gol + ataques perigosos
  const homeConversion = h.totalShots > 0 ? h.shotsOnGoal / h.totalShots : 0.3;
  const awayConversion = a.totalShots > 0 ? a.shotsOnGoal / a.totalShots : 0.3;

  // Projeção de gols restantes baseada no ritmo atual
  const homeShotsPerMin = h.totalShots / safeMin;
  const awayShotsPerMin = a.totalShots / safeMin;

  const homeLambdaRemaining = homeShotsPerMin * homeConversion * remainingMin * 0.12;
  const awayLambdaRemaining = awayShotsPerMin * awayConversion * remainingMin * 0.12;

  // Calcula probabilidades via Poisson para gols restantes
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

  // Normaliza
  const total = homeWin + draw + awayWin || 1;
  homeWin = Math.round((homeWin / total) * 100);
  draw = Math.round((draw / total) * 100);
  awayWin = 100 - homeWin - draw;

  // Odds implícitas (com margem 8%)
  const margin = 0.92;
  const toOdd = (p: number) => p > 0 ? Math.round((100 / p / margin) * 100) / 100 : 99;

  return {
    homeWinPoisson: homeWin,
    drawPoisson: draw,
    awayWinPoisson: awayWin,
    homeImpliedOdd: toOdd(homeWin),
    drawImpliedOdd: toOdd(draw),
    awayImpliedOdd: toOdd(awayWin),
  };
}

// ═══ CORNER TIMELINE (Cantos por período de 15min) ═══
export interface CornerPeriod {
  period: string;
  home: number;
  away: number;
}

// Como a API não dá breakdown por período, projetamos baseado no ritmo atual
export function projectCornersByPeriod(
  homeCorners: number,
  awayCorners: number,
  minute: number
): CornerPeriod[] {
  const safeMin = Math.max(minute, 1);
  const homeRate = homeCorners / safeMin;
  const awayRate = awayCorners / safeMin;

  const periods = ['0-15\'', '15-30\'', '30-45\'', '45-60\'', '60-75\'', '75-90\''];
  
  return periods.map((period, i) => {
    const periodEnd = (i + 1) * 15;
    if (periodEnd <= minute) {
      // Período já passou — distribuição proporcional
      const share = 15 / safeMin;
      return {
        period,
        home: Math.round(homeCorners * share * 10) / 10,
        away: Math.round(awayCorners * share * 10) / 10,
      };
    } else if (i * 15 < minute) {
      // Período atual (parcial)
      const elapsed = minute - i * 15;
      return {
        period,
        home: Math.round(homeRate * elapsed * 10) / 10,
        away: Math.round(awayRate * elapsed * 10) / 10,
      };
    } else {
      // Período futuro — projeção
      return {
        period,
        home: Math.round(homeRate * 15 * 10) / 10,
        away: Math.round(awayRate * 15 * 10) / 10,
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
  // Favorito = time com maior posse (proxy para domínio)
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
