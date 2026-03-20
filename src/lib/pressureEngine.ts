/**
 * MOTOR DE PRESSÃO REAL (PI - Pressure Index)
 * Fórmula: PI = (Ataques Perigosos/Minuto * 2) + (Chutes no Alvo * 1.5) + (Posse * 0.5)
 * 100% baseado em stats LIVE reais da API-Sports
 */

export interface PressureData {
  homePI: number;
  awayPI: number;
  homeSignal: string;
  awaySignal: string;
  homePressureShare: number;  // % de participação na pressão (NÃO probabilidade de gol)
  awayPressureShare: number;
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

export interface LiveStrategy {
  signal: 'entry' | 'wait' | 'caution';
  market: string;
  reason: string;
  confidence: number; // 0-100 baseado em dados reais
}

/**
 * Gera sugestões de trade LIVE baseadas no estado REAL do jogo
 * Usa: minuto, placar, stats em tempo real
 */
export function generateLiveStrategy(
  homeStats: LiveStats | null,
  awayStats: LiveStats | null,
  minute: number,
  homeGoals: number,
  awayGoals: number,
  homeName: string,
  awayName: string
): LiveStrategy[] {
  const strategies: LiveStrategy[] = [];
  const h = homeStats || { shotsOnGoal: 0, possession: 50, corners: 0, dangerousAttacks: 0, totalShots: 0 };
  const a = awayStats || { shotsOnGoal: 0, possession: 50, corners: 0, dangerousAttacks: 0, totalShots: 0 };
  
  const totalGoals = homeGoals + awayGoals;
  const totalShots = h.shotsOnGoal + a.shotsOnGoal;
  const totalDangerous = h.dangerousAttacks + a.dangerousAttacks;
  const totalCorners = h.corners + a.corners;
  const totalShotsAll = h.totalShots + a.totalShots;

  // ═══ OVER GOLS ═══
  // Se o jogo está com muita pressão e poucos gols (gol "atrasado")
  if (minute >= 25 && minute <= 75 && totalGoals === 0 && totalShots >= 4) {
    const conf = Math.min(85, 50 + totalShots * 4 + Math.floor(totalDangerous / 10));
    strategies.push({
      signal: 'entry',
      market: 'Over 0.5 Gols',
      reason: `${totalShots} chutes no gol, ${totalDangerous} ataques perigosos e 0 gols. Pressão acumulada.`,
      confidence: conf,
    });
  }

  if (minute >= 20 && minute <= 70 && totalGoals <= 1 && totalShots >= 6) {
    const conf = Math.min(80, 40 + totalShots * 3 + Math.floor(totalDangerous / 8));
    strategies.push({
      signal: 'entry',
      market: `Over ${totalGoals + 0.5} Gols`,
      reason: `${totalShots} chutes no gol com apenas ${totalGoals} gol(s). Ritmo alto para mais gols.`,
      confidence: conf,
    });
  }

  // Jogo aberto com muitos gols — Over alto
  if (totalGoals >= 2 && minute <= 65 && totalShots >= 4) {
    const conf = Math.min(78, 45 + totalGoals * 8 + totalShots * 2);
    strategies.push({
      signal: 'entry',
      market: `Over ${totalGoals + 0.5} Gols`,
      reason: `Jogo aberto: ${totalGoals} gols em ${minute}'. Ritmo de ${(totalGoals / minute * 90).toFixed(1)} gols/jogo.`,
      confidence: conf,
    });
  }

  // ═══ PRÓXIMO GOL ═══
  if (totalShots >= 2 && minute >= 15) {
    const homeStrength = h.shotsOnGoal * 2 + h.dangerousAttacks + h.totalShots * 0.3;
    const awayStrength = a.shotsOnGoal * 2 + a.dangerousAttacks + a.totalShots * 0.3;
    const total = homeStrength + awayStrength || 1;
    const dominantShare = Math.round((Math.max(homeStrength, awayStrength) / total) * 100);
    const dominant = homeStrength >= awayStrength ? homeName : awayName;

    if (dominantShare >= 60) {
      strategies.push({
        signal: 'entry',
        market: `Próximo Gol: ${dominant}`,
        reason: `${dominant} domina com ${dominantShare}% da pressão ofensiva real.`,
        confidence: Math.min(75, dominantShare),
      });
    }
  }

  // ═══ ESCANTEIOS ═══
  if (minute >= 20 && minute <= 75) {
    const cornersPerMin = totalCorners / minute;
    const projectedCorners = Math.round(cornersPerMin * 90);
    
    if (projectedCorners >= 8 && totalCorners >= 3) {
      strategies.push({
        signal: 'entry',
        market: `Over ${Math.floor(totalCorners + 1.5)} Cantos`,
        reason: `${totalCorners} cantos em ${minute}'. Projeção: ${projectedCorners} no jogo. Ritmo ${cornersPerMin.toFixed(2)}/min.`,
        confidence: Math.min(78, 45 + totalCorners * 4),
      });
    }
  }

  // ═══ AMBAS MARCAM ═══
  if (totalGoals >= 1 && minute <= 70) {
    const scoringTeam = homeGoals > 0 && awayGoals === 0 ? awayName : homeGoals === 0 && awayGoals > 0 ? homeName : null;
    if (scoringTeam) {
      const trailingStats = homeGoals === 0 ? h : a;
      const trailingPressure = trailingStats.shotsOnGoal + trailingStats.dangerousAttacks * 0.3;
      if (trailingPressure >= 2) {
        const conf = Math.min(72, 40 + Math.floor(trailingPressure * 8));
        strategies.push({
          signal: 'entry',
          market: 'Ambas Marcam - Sim',
          reason: `${scoringTeam} ainda sem gol mas com ${trailingStats.shotsOnGoal} chutes no gol e ${trailingStats.dangerousAttacks} ataques perigosos.`,
          confidence: conf,
        });
      }
    }
  }

  // ═══ CAUTELA — jogo travado ═══
  if (minute >= 60 && totalShots <= 2 && totalDangerous <= 20) {
    strategies.push({
      signal: 'caution',
      market: 'Under mantém',
      reason: `Jogo travado: apenas ${totalShots} chutes no gol em ${minute}'. Ritmo muito baixo.`,
      confidence: Math.min(80, 50 + (minute - 50)),
    });
  }

  // ═══ ESPERA ═══
  if (minute < 15 && strategies.length === 0) {
    strategies.push({
      signal: 'wait',
      market: 'Aguardar',
      reason: `Apenas ${minute}' de jogo. Dados insuficientes para entrada segura.`,
      confidence: 0,
    });
  }

  return strategies.sort((a, b) => b.confidence - a.confidence).slice(0, 3);
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

  // Participação na pressão (NÃO é probabilidade de gol)
  const total = homePI + awayPI + 0.01;
  const homePressureShare = Math.min(99, Math.round((homePI / total) * 100));
  const awayPressureShare = 100 - homePressureShare;

  const homeSignal = homePI >= 60 ? '🔴 PRESSÃO ALTA' : homePI >= 40 ? '🟡 Pressão Crescente' : '🟢 Estável';
  const awaySignal = awayPI >= 60 ? '🔴 PRESSÃO ALTA' : awayPI >= 40 ? '🟡 Pressão Crescente' : '🟢 Estável';

  const diff = Math.abs(homePI - awayPI);
  const dominance: 'home' | 'away' | 'balanced' =
    diff < 5 ? 'balanced' : homePI > awayPI ? 'home' : 'away';

  return { homePI, awayPI, homeSignal, awaySignal, homePressureShare, awayPressureShare, dominance };
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

  if (history.length > 0 && history[history.length - 1].minute === minute) {
    history[history.length - 1] = { minute, homePI, awayPI };
  } else {
    history.push({ minute, homePI, awayPI });
  }

  const trimmed = history.slice(-MAX_SNAPSHOTS);
  localStorage.setItem(key, JSON.stringify(trimmed));
  return trimmed;
}

export function getPIHistory(matchId: string | number): PISnapshot[] {
  const raw = localStorage.getItem(PI_HISTORY_KEY + matchId);
  return raw ? JSON.parse(raw) : [];
}
