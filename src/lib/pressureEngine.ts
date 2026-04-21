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

function safeDangerousAttacks(stats: LiveStats): number {
  if (stats.dangerousAttacks > 0) return stats.dangerousAttacks;
  return Math.round((stats.totalShots || 0) * 1.5 + (stats.corners || 0) * 2);
}

export function calculatePressureIndex(
  stats: LiveStats,
  minute: number
): number {
  const safeMinute = Math.max(minute, 1);
  const da = safeDangerousAttacks(stats);

  const attacksPerMinute = da / safeMinute;
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
  const totalDangerous = safeDangerousAttacks(h) + safeDangerousAttacks(a);
  const totalCorners = h.corners + a.corners;
  const hasData = totalShotsAll > 0 || h.possession !== 50 || a.possession !== 50;

  if (!hasData && minute < 10) {
    strategies.push({ signal: 'wait', market: 'Aguardar', reason: `Apenas ${minute}' — dados insuficientes.`, confidence: 0 });
    return strategies;
  }

  // ═══ FILTRO GLOBAL DE QUALIDADE ═══
  // Penalidade por minuto: entradas muito cedo são menos confiáveis
  const minutePenalty = minute < 25 ? Math.floor((25 - minute) * 1.2) : 0;
  const MIN_CONFIDENCE = 65; // Confiança mínima para emitir sinal

  // ═══ OVER GOLS ═══
  // Over 0.5: exigir min 25' e mais finalizações (padrão de loss em min 16-18)
  if (minute >= 25 && minute <= 78 && totalGoals === 0 && totalShotsAll >= 5 && totalShots >= 2) {
    const conf = Math.min(80, 48 + totalShots * 4 + totalShotsAll * 1.5 + Math.floor(totalDangerous / 6) - minutePenalty);
    if (conf >= MIN_CONFIDENCE) {
      strategies.push({ signal: 'entry', market: '⚽ Over 0.5 Gols', reason: `0 gols mas ${totalShotsAll} finalizações (${totalShots} no gol) em ${minute}'. Pressão acumulada.`, confidence: Math.round(conf) });
    }
  }

  // Over 1.5: exigir mais volume ofensivo
  if (minute >= 25 && minute <= 72 && totalGoals >= 1 && totalGoals <= 1 && totalShots >= 4 && totalShotsAll >= 7) {
    const conf = Math.min(76, 42 + totalShots * 3 + totalShotsAll * 0.8 + Math.floor(totalDangerous / 5) - minutePenalty);
    if (conf >= MIN_CONFIDENCE) {
      strategies.push({ signal: 'entry', market: `⚽ Over ${totalGoals + 0.5} Gols`, reason: `${totalShotsAll} finalizações (${totalShots} no gol) com apenas ${totalGoals} gol. Volume alto.`, confidence: Math.round(conf) });
    }
  }

  // Over 2.5+: confiança máxima reduzida, sem entradas após 60'
  if (totalGoals >= 2 && minute >= 15 && minute <= 60 && totalShotsAll >= 6) {
    const rhythm = (totalGoals / minute * 90).toFixed(1);
    const conf = Math.min(78, 40 + totalGoals * 6 + totalShots * 2 - minutePenalty);
    if (conf >= MIN_CONFIDENCE) {
      strategies.push({ signal: 'entry', market: `⚽ Over ${totalGoals + 0.5} Gols`, reason: `Jogo aberto: ${totalGoals} gols em ${minute}'. Ritmo: ${rhythm} gols/jogo. ${totalShots} no gol.`, confidence: Math.round(conf) });
    }
  }

  // ═══ UNDER ═══
  // Under mais conservador: exigir min 60' e pouquíssimo volume
  if (minute >= 60 && totalGoals <= 1 && totalShots <= 1 && totalShotsAll <= 3) {
    const conf = Math.min(78, 52 + (minute - 55) * 1.5 + (2 - totalShots) * 4);
    if (conf >= MIN_CONFIDENCE) {
      strategies.push({ signal: 'entry', market: `⚽ Under ${totalGoals + 1.5} Gols`, reason: `Jogo travado: apenas ${totalShotsAll} finalizações em ${minute}'. Zero volume ofensivo.`, confidence: Math.round(conf) });
    }
  }

  // ═══ RESULTADO / VITÓRIA ═══
  // Exigir min 30' e domínio mais claro (60%+)
  if (minute >= 30) {
    const homePower = h.shotsOnGoal * 3 + h.totalShots * 1.5 + safeDangerousAttacks(h) * 0.5 + (h.possession > 55 ? 5 : 0);
    const awayPower = a.shotsOnGoal * 3 + a.totalShots * 1.5 + safeDangerousAttacks(a) * 0.5 + (a.possession > 55 ? 5 : 0);
    const totalPower = homePower + awayPower || 1;
    const homeShare = Math.round((homePower / totalPower) * 100);

    if (homeGoals > awayGoals && homeShare >= 60) {
      const conf = Math.min(76, 45 + (homeGoals - awayGoals) * 8 + Math.floor(homeShare / 6));
      if (conf >= MIN_CONFIDENCE) {
        strategies.push({ signal: 'entry', market: `🏆 Vitória ${homeName}`, reason: `Vencendo ${homeGoals}-${awayGoals} com ${homeShare}% do domínio ofensivo. ${h.shotsOnGoal} chutes no gol.`, confidence: Math.round(conf) });
      }
    } else if (awayGoals > homeGoals && (100 - homeShare) >= 60) {
      const conf = Math.min(76, 45 + (awayGoals - homeGoals) * 8 + Math.floor((100 - homeShare) / 6));
      if (conf >= MIN_CONFIDENCE) {
        strategies.push({ signal: 'entry', market: `🏆 Vitória ${awayName}`, reason: `Vencendo ${awayGoals}-${homeGoals} com ${100 - homeShare}% do domínio ofensivo. ${a.shotsOnGoal} chutes no gol.`, confidence: Math.round(conf) });
      }
    } else if (homeGoals === awayGoals && Math.abs(homeShare - 50) >= 20 && minute >= 40) {
      const dominant = homeShare > 50 ? homeName : awayName;
      const share = homeShare > 50 ? homeShare : 100 - homeShare;
      const conf = Math.min(68, 38 + Math.floor(share / 3));
      if (conf >= MIN_CONFIDENCE) {
        strategies.push({ signal: 'entry', market: `🏆 Chance Dupla ${dominant}`, reason: `Empate ${homeGoals}-${awayGoals} mas ${dominant} domina com ${share}% da pressão ofensiva.`, confidence: Math.round(conf) });
      }
    }
  }

  // ═══ PRÓXIMO GOL ═══
  // Exigir domínio >= 65% e mais volume (padrão de loss com 58%)
  if (totalShotsAll >= 5 && minute >= 20) {
    const homeStr = h.shotsOnGoal * 3 + h.totalShots + safeDangerousAttacks(h) * 0.5 + h.corners;
    const awayStr = a.shotsOnGoal * 3 + a.totalShots + safeDangerousAttacks(a) * 0.5 + a.corners;
    const total = homeStr + awayStr || 1;
    const domShare = Math.round((Math.max(homeStr, awayStr) / total) * 100);
    const dominant = homeStr >= awayStr ? homeName : awayName;
    if (domShare >= 65) {
      const conf = Math.min(72, domShare - minutePenalty);
      if (conf >= MIN_CONFIDENCE) {
        strategies.push({ signal: 'entry', market: `🎯 Próximo Gol: ${dominant}`, reason: `${dominant} concentra ${domShare}% das ações ofensivas. ${Math.max(h.shotsOnGoal, a.shotsOnGoal)} chutes no gol.`, confidence: Math.round(conf) });
      }
    }
  }

  // ═══ AMBAS MARCAM ═══
  // Reduzir janela max para 65' (losses em 87-88')
  if (totalGoals >= 1 && minute >= 20 && minute <= 65) {
    const scoreless = homeGoals > 0 && awayGoals === 0 ? awayName : homeGoals === 0 && awayGoals > 0 ? homeName : null;
    if (scoreless) {
      const trailing = homeGoals === 0 ? h : a;
      const trPressure = trailing.shotsOnGoal * 3 + trailing.totalShots + safeDangerousAttacks(trailing) * 0.3 + trailing.corners;
      if (trPressure >= 4) { // Exigir mais pressão real (era 2)
        const conf = Math.min(72, 40 + Math.floor(trPressure * 4) - minutePenalty);
        if (conf >= MIN_CONFIDENCE) {
          strategies.push({ signal: 'entry', market: '⚽ Ambas Marcam - Sim', reason: `${scoreless} sem gol mas ativo: ${trailing.shotsOnGoal} no gol, ${trailing.totalShots} finalizações, ${trailing.corners} cantos.`, confidence: Math.round(conf) });
        }
      }
    }
  }

  // ═══ ESCANTEIOS ═══
  if (minute >= 20 && minute <= 75) {
    const cornersPerMin = totalCorners / Math.max(minute, 1);
    const projected = Math.round(cornersPerMin * 90);
    if (totalCorners >= 3 && projected >= 8) { // Mais conservador
      const target = totalCorners + 1;
      const conf = Math.min(74, 42 + totalCorners * 4);
      if (conf >= MIN_CONFIDENCE) {
        strategies.push({ signal: 'entry', market: `📐 Over ${target}.5 Cantos`, reason: `${totalCorners} cantos em ${minute}'. Projeção: ${projected}/jogo. Ritmo ${cornersPerMin.toFixed(2)}/min.`, confidence: Math.round(conf) });
      }
    } else if (minute >= 55 && totalCorners <= 2) {
      const conf = Math.min(72, 48 + (minute - 50));
      if (conf >= MIN_CONFIDENCE) {
        strategies.push({ signal: 'entry', market: `📐 Under ${totalCorners + 2}.5 Cantos`, reason: `Apenas ${totalCorners} cantos em ${minute}'. Ritmo muito baixo.`, confidence: Math.round(conf) });
      }
    }
  }

  // ═══ CARTÕES ═══
  if (minute >= 35 && totalShotsAll >= 6) {
    const possessionDiff = Math.abs(h.possession - a.possession);
    if (possessionDiff >= 18 && totalGoals <= 1) {
      const trailing = h.possession < a.possession ? homeName : awayName;
      const conf = Math.min(68, 42 + Math.floor(possessionDiff / 2) + Math.floor(totalShotsAll / 3));
      if (conf >= MIN_CONFIDENCE) {
        strategies.push({ signal: 'entry', market: '🟨 Over 0.5 Cartões (Próx.)', reason: `${trailing} com menos posse (${Math.min(h.possession, a.possession)}%) tende a cometer mais faltas. Jogo disputado.`, confidence: Math.round(conf) });
      }
    }
  }

  // ═══ HANDICAP ═══
  if (minute >= 35 && minute <= 70 && Math.abs(homeGoals - awayGoals) >= 2) {
    const trailing = homeGoals > awayGoals ? awayName : homeName;
    const diff = Math.abs(homeGoals - awayGoals);
    const trailingStats = homeGoals < awayGoals ? h : a;
    const trPressure = trailingStats.shotsOnGoal + trailingStats.totalShots * 0.5;
    if (trPressure >= 3) { // Exigir mais pressão
      const conf = Math.min(72, 42 + Math.floor(trPressure * 3.5));
      if (conf >= MIN_CONFIDENCE) {
        strategies.push({ signal: 'entry', market: `⚡ Handicap +${diff - 0.5} ${trailing}`, reason: `${trailing} perdendo por ${diff} mas com ${trailingStats.shotsOnGoal} chutes no gol. Pode descontar.`, confidence: Math.round(conf) });
      }
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
