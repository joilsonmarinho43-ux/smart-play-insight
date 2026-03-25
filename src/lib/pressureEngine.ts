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
  homePressureShare: number;
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
  confidence: number;
}

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
  const totalShotsAll = h.totalShots + a.totalShots;
  const totalDangerous = h.dangerousAttacks + a.dangerousAttacks;
  const totalCorners = h.corners + a.corners;
  const hasData = totalShotsAll > 0 || h.possession !== 50 || a.possession !== 50;

  if (!hasData && minute < 10) {
    strategies.push({ signal: 'wait', market: 'Aguardar', reason: `Apenas ${minute}' — dados insuficientes.`, confidence: 0 });
    return strategies;
  }

  // ═══ OVER GOLS ═══
  if (minute >= 15 && minute <= 80 && totalGoals === 0 && totalShotsAll >= 3) {
    const conf = Math.min(82, 45 + totalShots * 5 + totalShotsAll * 2 + Math.floor(totalDangerous / 8));
    strategies.push({ signal: 'entry', market: '⚽ Over 0.5 Gols', reason: `0 gols mas ${totalShotsAll} finalizações (${totalShots} no gol). Pressão acumulada sem converter.`, confidence: conf });
  }

  if (minute >= 20 && minute <= 75 && totalGoals <= 1 && (totalShots >= 4 || totalShotsAll >= 6)) {
    const conf = Math.min(78, 40 + totalShots * 3 + totalShotsAll + Math.floor(totalDangerous / 6));
    strategies.push({ signal: 'entry', market: `⚽ Over ${totalGoals + 0.5} Gols`, reason: `${totalShotsAll} finalizações com apenas ${totalGoals} gol(s). Ritmo ofensivo alto.`, confidence: conf });
  }

  if (totalGoals >= 2 && minute <= 70 && totalShotsAll >= 4) {
    const rhythm = (totalGoals / minute * 90).toFixed(1);
    const conf = Math.min(80, 42 + totalGoals * 8 + totalShots * 2);
    strategies.push({ signal: 'entry', market: `⚽ Over ${totalGoals + 0.5} Gols`, reason: `Jogo aberto: ${totalGoals} gols em ${minute}'. Ritmo: ${rhythm} gols/jogo.`, confidence: conf });
  }

  // ═══ UNDER ═══
  if (minute >= 55 && totalGoals <= 1 && totalShots <= 2 && totalShotsAll <= 4) {
    const conf = Math.min(80, 50 + (minute - 50) + (3 - totalShots) * 3);
    strategies.push({ signal: 'entry', market: `⚽ Under ${totalGoals + 1.5} Gols`, reason: `Jogo travado: ${totalShotsAll} finalizações em ${minute}'. Sem volume ofensivo.`, confidence: conf });
  }

  // ═══ RESULTADO / VITÓRIA ═══
  if (minute >= 15) {
    const homePower = h.shotsOnGoal * 3 + h.totalShots * 1.5 + h.dangerousAttacks * 0.5 + (h.possession > 55 ? 5 : 0);
    const awayPower = a.shotsOnGoal * 3 + a.totalShots * 1.5 + a.dangerousAttacks * 0.5 + (a.possession > 55 ? 5 : 0);
    const totalPower = homePower + awayPower || 1;
    const homeShare = Math.round((homePower / totalPower) * 100);

    if (homeGoals > awayGoals && homeShare >= 55) {
      const conf = Math.min(78, 45 + (homeGoals - awayGoals) * 10 + Math.floor(homeShare / 5));
      strategies.push({ signal: 'entry', market: `🏆 Vitória ${homeName}`, reason: `Vencendo ${homeGoals}-${awayGoals} com ${homeShare}% do domínio ofensivo. ${h.shotsOnGoal} chutes no gol.`, confidence: conf });
    } else if (awayGoals > homeGoals && (100 - homeShare) >= 55) {
      const conf = Math.min(78, 45 + (awayGoals - homeGoals) * 10 + Math.floor((100 - homeShare) / 5));
      strategies.push({ signal: 'entry', market: `🏆 Vitória ${awayName}`, reason: `Vencendo ${awayGoals}-${homeGoals} com ${100 - homeShare}% do domínio ofensivo. ${a.shotsOnGoal} chutes no gol.`, confidence: conf });
    } else if (homeGoals === awayGoals && Math.abs(homeShare - 50) >= 15) {
      const dominant = homeShare > 50 ? homeName : awayName;
      const share = homeShare > 50 ? homeShare : 100 - homeShare;
      const conf = Math.min(68, 35 + Math.floor(share / 3));
      strategies.push({ signal: 'entry', market: `🏆 Chance Dupla ${dominant}`, reason: `Empate ${homeGoals}-${awayGoals} mas ${dominant} domina com ${share}% da pressão ofensiva.`, confidence: conf });
    }
  }

  // ═══ PRÓXIMO GOL ═══
  if (totalShotsAll >= 3 && minute >= 10) {
    const homeStr = h.shotsOnGoal * 3 + h.totalShots + h.dangerousAttacks * 0.5 + h.corners;
    const awayStr = a.shotsOnGoal * 3 + a.totalShots + a.dangerousAttacks * 0.5 + a.corners;
    const total = homeStr + awayStr || 1;
    const domShare = Math.round((Math.max(homeStr, awayStr) / total) * 100);
    const dominant = homeStr >= awayStr ? homeName : awayName;
    if (domShare >= 58) {
      strategies.push({ signal: 'entry', market: `🎯 Próximo Gol: ${dominant}`, reason: `${dominant} concentra ${domShare}% das ações ofensivas.`, confidence: Math.min(72, domShare) });
    }
  }

  // ═══ AMBAS MARCAM ═══
  if (totalGoals >= 1 && minute <= 75) {
    const scoreless = homeGoals > 0 && awayGoals === 0 ? awayName : homeGoals === 0 && awayGoals > 0 ? homeName : null;
    if (scoreless) {
      const trailing = homeGoals === 0 ? h : a;
      const trPressure = trailing.shotsOnGoal * 3 + trailing.totalShots + trailing.dangerousAttacks * 0.3 + trailing.corners;
      if (trPressure >= 2) {
        const conf = Math.min(72, 38 + Math.floor(trPressure * 5));
        strategies.push({ signal: 'entry', market: '⚽ Ambas Marcam - Sim', reason: `${scoreless} sem gol mas ativo: ${trailing.shotsOnGoal} no gol, ${trailing.totalShots} finalizações, ${trailing.corners} cantos.`, confidence: conf });
      }
    }
  }

  // ═══ ESCANTEIOS ═══
  if (minute >= 15 && minute <= 80) {
    const cornersPerMin = totalCorners / Math.max(minute, 1);
    const projected = Math.round(cornersPerMin * 90);
    if (totalCorners >= 2 && projected >= 7) {
      const target = totalCorners + 1;
      const conf = Math.min(76, 40 + totalCorners * 5);
      strategies.push({ signal: 'entry', market: `📐 Over ${target}.5 Cantos`, reason: `${totalCorners} cantos em ${minute}'. Projeção: ${projected}/jogo. Ritmo ${cornersPerMin.toFixed(2)}/min.`, confidence: conf });
    } else if (minute >= 50 && totalCorners <= 2) {
      const conf = Math.min(72, 45 + (minute - 45));
      strategies.push({ signal: 'entry', market: `📐 Under ${totalCorners + 2}.5 Cantos`, reason: `Apenas ${totalCorners} cantos em ${minute}'. Ritmo muito baixo.`, confidence: conf });
    }
  }

  // ═══ CARTÕES ═══
  if (minute >= 30 && totalShotsAll >= 5) {
    const possessionDiff = Math.abs(h.possession - a.possession);
    if (possessionDiff >= 15 && totalGoals <= 1) {
      const trailing = h.possession < a.possession ? homeName : awayName;
      const conf = Math.min(68, 40 + Math.floor(possessionDiff / 2) + Math.floor(totalShotsAll / 3));
      strategies.push({ signal: 'entry', market: '🟨 Over 0.5 Cartões (Próx.)', reason: `${trailing} com menos posse (${Math.min(h.possession, a.possession)}%) tende a cometer mais faltas. Jogo disputado.`, confidence: conf });
    }
  }

  // ═══ HANDICAP ═══
  if (minute >= 30 && minute <= 75 && Math.abs(homeGoals - awayGoals) >= 2) {
    const trailing = homeGoals > awayGoals ? awayName : homeName;
    const diff = Math.abs(homeGoals - awayGoals);
    const trailingStats = homeGoals < awayGoals ? h : a;
    const trPressure = trailingStats.shotsOnGoal + trailingStats.totalShots * 0.5;
    if (trPressure >= 2) {
      const conf = Math.min(72, 40 + Math.floor(trPressure * 4));
      strategies.push({ signal: 'entry', market: `⚡ Handicap +${diff - 0.5} ${trailing}`, reason: `${trailing} perdendo por ${diff} mas com ${trailingStats.shotsOnGoal} chutes no gol. Pode descontar.`, confidence: conf });
    }
  }

  // ═══ CAUTELA ═══
  if (minute >= 60 && totalShotsAll <= 3 && totalCorners <= 2 && totalGoals === 0) {
    strategies.push({ signal: 'caution', market: '⚠️ Jogo Travado', reason: `Apenas ${totalShotsAll} finalizações e ${totalCorners} cantos em ${minute}'. Evitar entradas agressivas.`, confidence: Math.min(80, 50 + (minute - 50)) });
  }

  // ═══ AGUARDAR ═══
  if (strategies.length === 0) {
    strategies.push({ signal: 'wait', market: 'Aguardar', reason: `Dados insuficientes para entrada segura em ${minute}'.`, confidence: 0 });
  }

  return strategies.sort((a, b) => b.confidence - a.confidence).slice(0, 4);
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
 * Histórico de PI para o gráfico sparkline
 * Aumentado para 30 snapshots para melhor visualização do momentum
 */
export interface PISnapshot {
  minute: number;
  homePI: number;
  awayPI: number;
}

const PI_HISTORY_KEY = 'pi_history_';
const MAX_SNAPSHOTS = 30;

export function recordPISnapshot(matchId: string | number, homePI: number, awayPI: number, minute: number): PISnapshot[] {
  const key = PI_HISTORY_KEY + matchId;
  let history: PISnapshot[] = [];
  
  try {
    const raw = localStorage.getItem(key);
    history = raw ? JSON.parse(raw) : [];
  } catch {
    history = [];
  }

  // Avoid duplicate entries for the same minute
  if (history.length > 0 && history[history.length - 1].minute === minute) {
    history[history.length - 1] = { minute, homePI, awayPI };
  } else {
    history.push({ minute, homePI, awayPI });
  }

  const trimmed = history.slice(-MAX_SNAPSHOTS);
  
  try {
    localStorage.setItem(key, JSON.stringify(trimmed));
  } catch {
    // localStorage full — clear old entries
    try {
      const keys = Object.keys(localStorage).filter(k => k.startsWith(PI_HISTORY_KEY));
      keys.slice(0, Math.max(1, keys.length - 5)).forEach(k => localStorage.removeItem(k));
      localStorage.setItem(key, JSON.stringify(trimmed));
    } catch { /* give up silently */ }
  }
  
  return trimmed;
}

export function getPIHistory(matchId: string | number): PISnapshot[] {
  try {
    const raw = localStorage.getItem(PI_HISTORY_KEY + matchId);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
