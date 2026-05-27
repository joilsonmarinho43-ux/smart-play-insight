/**
 * LIVE GOAL ENGINE — Refinamento aditivo (NÃO substitui motores existentes)
 *
 * Combina:
 *  - Pressure Score 0-100 com ênfase em SoG, DA recentes e janela de 10min
 *  - Pesos de liga (positivos: ligas ofensivas / negativos: ligas defensivas)
 *  - Detecção de janela ideal de gol (18-35, 55-75, 75+)
 *  - Leitura de pressão recente via PI history (últimos 5/10 min)
 *  - Badge de PRESSÃO EXTREMA
 *  - Detecção de VALUE em Over (odd atrasada vs intensidade)
 *  - Anti falso positivo (posse estéril, ritmo lento)
 *  - Classificação Elite / Alta / Moderada / Baixa
 *
 * Saída pensada para ser exibida como overlay sem quebrar layout atual.
 */

import type { PressureData, PISnapshot, LiveStats } from '@/lib/pressureEngine';

export type ConfidenceTier = 'elite' | 'alta' | 'moderada' | 'baixa';
export type GoalMoment = 'inicial' | 'janela1' | 'meio' | 'janela2' | 'final' | 'fora';

export interface LiveGoalRead {
  pressureScore: number;          // 0-100
  tier: ConfidenceTier;
  tierLabel: string;              // 🟢 Elite / 🔵 Alta / 🟡 Moderada / 🔴 Baixa
  leagueWeight: number;           // -10..+12
  moment: GoalMoment;
  momentLabel: string;
  extremePressure: boolean;       // 🔥 PRESSÃO EXTREMA
  valueOver: boolean;             // odd atrasada vs intensidade
  antiFalsePositive: boolean;     // posse estéril detectada
  intensityBar: number;           // 0-100 (barra ofensiva últimos 10')
  recommendation: string | null;  // ex: "Over 1.5", "Próximo Gol: X"
  reason: string;
}

// ─────────────────────────────────────────────────────────────
// Pesos por liga (ajuste fino, não bloqueia)
// ─────────────────────────────────────────────────────────────
const LEAGUE_BOOST: Array<{ match: RegExp; weight: number }> = [
  // OFENSIVAS (peso positivo)
  { match: /eredivisie/i, weight: 12 },
  { match: /bundesliga/i, weight: 10 },
  { match: /eliteserien/i, weight: 10 },
  { match: /allsvenskan/i, weight: 9 },
  { match: /jupiler|belgian.*pro|belgium/i, weight: 8 },
  { match: /superliga|denmark|danish/i, weight: 8 },
  { match: /super league.*swiss|switzerland/i, weight: 7 },
  { match: /bundesliga.*austria|austrian/i, weight: 7 },
  // DEFENSIVAS (peso negativo, sem bloquear)
  { match: /brasileir(ã|a)o.*s[ée]rie\s*a|serie a.*brazil/i, weight: -6 },
  { match: /s[ée]rie b.*brasil|brazilian.*serie b/i, weight: -8 },
  { match: /argentina|liga profesional|primera.*argentin/i, weight: -7 },
  { match: /copa libertadores|sudamericana/i, weight: -4 },
];

export function getLeagueWeight(leagueName?: string): number {
  if (!leagueName) return 0;
  for (const rule of LEAGUE_BOOST) {
    if (rule.match.test(leagueName)) return rule.weight;
  }
  return 0;
}

// ─────────────────────────────────────────────────────────────
// Janela ideal de gol
// ─────────────────────────────────────────────────────────────
export function detectGoalMoment(minute: number): { moment: GoalMoment; label: string; bonus: number } {
  if (minute < 18) return { moment: 'inicial', label: 'Aquecendo', bonus: 0 };
  if (minute <= 35) return { moment: 'janela1', label: '🎯 Janela Ideal (18-35)', bonus: 8 };
  if (minute < 55) return { moment: 'meio', label: 'Intervalo Tático', bonus: 2 };
  if (minute <= 75) return { moment: 'janela2', label: '🎯 Janela Ideal (55-75)', bonus: 10 };
  if (minute <= 90) return { moment: 'final', label: '🎯 Reta Final (75+)', bonus: 6 };
  return { moment: 'fora', label: 'Acréscimos', bonus: 3 };
}

// ─────────────────────────────────────────────────────────────
// Recência: PI dos últimos 5 e 10 min (a partir do history)
// ─────────────────────────────────────────────────────────────
function recentPIWindow(history: PISnapshot[], minute: number, windowMin: number) {
  if (!history || history.length === 0) return { home: 0, away: 0, delta: 0 };
  const from = Math.max(0, minute - windowMin);
  const window = history.filter(h => h.minute >= from && h.minute <= minute);
  if (window.length === 0) return { home: 0, away: 0, delta: 0 };
  const avgHome = window.reduce((s, h) => s + h.homePI, 0) / window.length;
  const avgAway = window.reduce((s, h) => s + h.awayPI, 0) / window.length;
  const first = window[0];
  const last = window[window.length - 1];
  const delta = ((last.homePI + last.awayPI) - (first.homePI + first.awayPI));
  return { home: avgHome, away: avgAway, delta };
}

// ─────────────────────────────────────────────────────────────
// Pressure Score 0-100 (motor refinado p/ gols)
// ─────────────────────────────────────────────────────────────
function computePressureScore(
  h: LiveStats,
  a: LiveStats,
  minute: number,
  pressure: PressureData,
  recent5: { delta: number; home: number; away: number },
  recent10: { delta: number; home: number; away: number },
): number {
  const safeMin = Math.max(minute, 1);
  const totalSoG = (h.shotsOnGoal || 0) + (a.shotsOnGoal || 0);
  const totalShots = (h.totalShots || 0) + (a.totalShots || 0);
  const totalDA = (h.dangerousAttacks || 0) + (a.dangerousAttacks || 0);
  const totalCorners = (h.corners || 0) + (a.corners || 0);

  // Frequência ofensiva por minuto
  const sogRate = (totalSoG / safeMin) * 90;       // proj/jogo
  const shotsRate = (totalShots / safeMin) * 90;
  const daRate = (totalDA / safeMin) * 90;

  // Componentes (pesos: SoG e DA recentes têm peso maior)
  const sogScore = Math.min(35, sogRate * 2.2);             // 0-35
  const shotsScore = Math.min(15, shotsRate * 0.6);          // 0-15
  const daScore = Math.min(20, daRate / 6);                  // 0-20
  const cornerScore = Math.min(8, totalCorners * 0.8);       // 0-8
  const piScore = Math.min(12, (pressure.homePI + pressure.awayPI) / 12); // 0-12
  // Bônus de momentum recente
  const momentumBonus = Math.min(10, Math.max(0, recent10.delta * 0.4));
  // Penalidade leve se últimos 5' caíram
  const recentDrop = recent5.delta < -3 ? Math.min(8, Math.abs(recent5.delta) * 0.6) : 0;

  let score = sogScore + shotsScore + daScore + cornerScore + piScore + momentumBonus - recentDrop;
  return Math.round(Math.max(0, Math.min(100, score)));
}

// ─────────────────────────────────────────────────────────────
// Anti falso positivo: posse estéril, ritmo lento
// ─────────────────────────────────────────────────────────────
function detectAntiFalsePositive(h: LiveStats, a: LiveStats, minute: number): boolean {
  if (minute < 25) return false;
  const totalSoG = (h.shotsOnGoal || 0) + (a.shotsOnGoal || 0);
  const totalShots = (h.totalShots || 0) + (a.totalShots || 0);
  const possDiff = Math.abs((h.possession || 50) - (a.possession || 50));
  // Posse alta mas zero efetividade
  if (possDiff >= 25 && totalSoG <= 1 && totalShots <= 4) return true;
  // Ritmo extremamente lento
  if (minute >= 35 && totalShots <= 3) return true;
  return false;
}

// ─────────────────────────────────────────────────────────────
// Classificação por tier
// ─────────────────────────────────────────────────────────────
function classifyTier(adjusted: number, antiFP: boolean): { tier: ConfidenceTier; label: string } {
  if (antiFP) return { tier: 'baixa', label: '🔴 Baixa' };
  if (adjusted >= 82) return { tier: 'elite', label: '🟢 Elite' };
  if (adjusted >= 68) return { tier: 'alta', label: '🔵 Alta' };
  if (adjusted >= 52) return { tier: 'moderada', label: '🟡 Moderada' };
  return { tier: 'baixa', label: '🔴 Baixa' };
}

// ─────────────────────────────────────────────────────────────
// Value detection: pressão incompatível com cenário (proxy via score x gols)
// ─────────────────────────────────────────────────────────────
function detectValueOver(score: number, totalGoals: number, minute: number): boolean {
  if (minute < 20 || minute > 78) return false;
  // Score alto e poucos gols => odd de Over tende a estar atrasada
  if (score >= 72 && totalGoals <= 1) return true;
  if (score >= 80 && totalGoals === 0) return true;
  return false;
}

// ─────────────────────────────────────────────────────────────
// Recomendação principal (não substitui generateLiveStrategy)
// ─────────────────────────────────────────────────────────────
function buildRecommendation(
  score: number, totalGoals: number, minute: number,
  homeName: string, awayName: string,
  pressure: PressureData,
): string | null {
  if (score < 55) return null;
  if (totalGoals === 0 && minute >= 25) return 'Over 0.5 Gols';
  if (totalGoals <= 1 && score >= 72) return `Over ${totalGoals + 0.5} Gols`;
  if (score >= 78) {
    const dom = pressure.homePI >= pressure.awayPI ? homeName : awayName;
    return `Próximo Gol: ${dom}`;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// API principal
// ─────────────────────────────────────────────────────────────
export interface LiveGoalInput {
  homeStats: LiveStats | null;
  awayStats: LiveStats | null;
  minute: number;
  homeGoals: number;
  awayGoals: number;
  homeName: string;
  awayName: string;
  league?: string;
  pressure: PressureData;
  history: PISnapshot[];
}

const EMPTY_STATS: LiveStats = { shotsOnGoal: 0, possession: 50, corners: 0, dangerousAttacks: 0, totalShots: 0 };

export function analyzeLiveGoal(input: LiveGoalInput): LiveGoalRead {
  const h = input.homeStats || EMPTY_STATS;
  const a = input.awayStats || EMPTY_STATS;
  const minute = Math.max(0, input.minute);
  const totalGoals = input.homeGoals + input.awayGoals;

  const recent5 = recentPIWindow(input.history, minute, 5);
  const recent10 = recentPIWindow(input.history, minute, 10);

  const baseScore = computePressureScore(h, a, minute, input.pressure, recent5, recent10);
  const leagueWeight = getLeagueWeight(input.league);
  const moment = detectGoalMoment(minute);

  // score ajustado para tiering
  let adjusted = baseScore + leagueWeight + moment.bonus;
  const antiFP = detectAntiFalsePositive(h, a, minute);
  if (antiFP) adjusted -= 18;
  adjusted = Math.max(0, Math.min(100, adjusted));

  const { tier, label } = classifyTier(adjusted, antiFP);

  const totalSoG = (h.shotsOnGoal || 0) + (a.shotsOnGoal || 0);
  const recentIntensity = Math.min(100, Math.round(((recent10.home + recent10.away) / 2) + totalSoG * 3));

  const extremePressure =
    !antiFP && baseScore >= 78 && totalSoG >= 3 && (recent10.delta >= 3 || (input.pressure.homePI >= 65 || input.pressure.awayPI >= 65));

  const valueOver = !antiFP && detectValueOver(adjusted, totalGoals, minute);
  const recommendation = buildRecommendation(adjusted, totalGoals, minute, input.homeName, input.awayName, input.pressure);

  const reason =
    antiFP ? 'Posse estéril / ritmo lento — sinal atenuado.' :
    extremePressure ? `Pressão extrema sustentada (Δ10' +${recent10.delta.toFixed(1)}, SoG ${totalSoG}).` :
    valueOver ? 'Intensidade alta com placar ainda baixo — Over com valor.' :
    `Score ofensivo ${baseScore} | momento ${moment.label}.`;

  return {
    pressureScore: baseScore,
    tier,
    tierLabel: label,
    leagueWeight,
    moment: moment.moment,
    momentLabel: moment.label,
    extremePressure,
    valueOver,
    antiFalsePositive: antiFP,
    intensityBar: recentIntensity,
    recommendation,
    reason,
  };
}
