/**
 * 🔥 MOTOR DE PRESSÃO REAL (PI - Pressure Index)
 * Fórmula: PI = (Ataques Perigosos/Minuto * 2) + (Chutes no Alvo * 1.5) + (Posse * 0.5)
 * 100% baseado em stats LIVE - sem lógica pré-jogo.
 */

export interface PressureData {
  homePI: number;
  awayPI: number;
  homeSignal: string;
  awaySignal: string;
  homeProbGol: number;
  awayProbGol: number;
  dominance: 'home' | 'away' | 'balanced';
}

export interface LiveStats {
  shotsOnGoal: number;
  possession: number;
  corners: number;
  dangerousAttacks: number;
  totalShots: number;
}

export function calculatePressureIndex(
  stats: LiveStats,
  minute: number
): number {
  const safeMinute = Math.max(minute, 1);

  const attacksPerMinute = stats.dangerousAttacks / safeMinute;
  const pi =
    attacksPerMinute * 2 +
    stats.shotsOnGoal * 1.5 +
    stats.possession * 0.5;

  return Math.round(pi * 100) / 100;
}

export function analyzeLivePressure(
  homeStats: LiveStats | null,
  awayStats: LiveStats | null,
  minute: number
): PressureData {
  const h = homeStats || { shotsOnGoal: 0, possession: 50, corners: 0, dangerousAttacks: 0, totalShots: 0 };
  const a = awayStats || { shotsOnGoal: 0, possession: 50, corners: 0, dangerousAttacks: 0, totalShots: 0 };

  const homePI = calculatePressureIndex(h, minute);
  const awayPI = calculatePressureIndex(a, minute);

  // Probabilidade de gol baseada no PI — sem travas artificiais
  const homeProbGol = Math.min(99, Math.round((homePI / (homePI + awayPI + 0.01)) * 100));
  const awayProbGol = 100 - homeProbGol;

  const homeSignal = homePI >= 60 ? '🔴 ALTA PROB. GOL' : homePI >= 40 ? '🟡 Pressão Crescente' : '🟢 Estável';
  const awaySignal = awayPI >= 60 ? '🔴 ALTA PROB. GOL' : awayPI >= 40 ? '🟡 Pressão Crescente' : '🟢 Estável';

  const diff = Math.abs(homePI - awayPI);
  const dominance: 'home' | 'away' | 'balanced' =
    diff < 5 ? 'balanced' : homePI > awayPI ? 'home' : 'away';

  return { homePI, awayPI, homeSignal, awaySignal, homeProbGol, awayProbGol, dominance };
}

/**
 * Histórico de PI para o gráfico sparkline (últimos 10 snapshots)
 */
export interface PISnapshot {
  minute: number;
  homePI: number;
  awayPI: number;
}

const PI_HISTORY_KEY = 'pi_history_';
const MAX_SNAPSHOTS = 10;

export function recordPISnapshot(matchId: string | number, homePI: number, awayPI: number, minute: number) {
  const key = PI_HISTORY_KEY + matchId;
  const raw = localStorage.getItem(key);
  const history: PISnapshot[] = raw ? JSON.parse(raw) : [];

  // Evita duplicata do mesmo minuto
  if (history.length > 0 && history[history.length - 1].minute === minute) {
    history[history.length - 1] = { minute, homePI, awayPI };
  } else {
    history.push({ minute, homePI, awayPI });
  }

  // Mantém apenas os últimos MAX_SNAPSHOTS
  const trimmed = history.slice(-MAX_SNAPSHOTS);
  localStorage.setItem(key, JSON.stringify(trimmed));
  return trimmed;
}

export function getPIHistory(matchId: string | number): PISnapshot[] {
  const raw = localStorage.getItem(PI_HISTORY_KEY + matchId);
  return raw ? JSON.parse(raw) : [];
}
