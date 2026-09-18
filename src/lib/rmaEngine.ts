/**
 * RMA ENGINE — Ritmo, Momento e Agressividade
 * Canonical live-pressure validator. This score is a validation signal,
 * never a market probability.
 */

export type RMAVerdict = 'CONFIRMADO' | 'BLOQUEADO' | 'NEUTRO';

export interface RMAResult {
  verdict: RMAVerdict;
  score: number;
  blockReason: string | null;
}

export interface RMAInput {
  minute: number;
  pressure: number;
  dangerousAttacks: number;
  totalShots: number;
  shotsOnGoal: number;
  leagueWeight?: number;
  momentumDelta?: number;
  daEstimated?: boolean;
}

/** Same scoring/gates used by the edge-runtime RMA validator. */
export function evaluateRMA(i: RMAInput): RMAResult {
  const minute = Math.max(1, i.minute);
  const daRate = (Math.max(0, i.dangerousAttacks) / minute) * 10;
  const shotsRate = (Math.max(0, i.totalShots) / minute) * 10;
  const sotRate = (Math.max(0, i.shotsOnGoal) / minute) * 10;
  const estimated = i.daEstimated === true;

  const qualityPenalty = estimated ? 8 : 0;
  const earlyPenalty = minute < 15 ? 6 : minute < 20 ? 3 : 0;
  const raw =
    i.pressure * 0.24 +
    daRate * 0.28 +
    shotsRate * 0.18 +
    sotRate * 0.30 +
    Math.max(-4, Math.min(5, i.leagueWeight ?? 0)) +
    Math.max(-5, Math.min(5, i.momentumDelta ?? 0)) -
    qualityPenalty - earlyPenalty;

  const score = Math.round(Math.max(0, Math.min(100, raw)) * 100) / 100;

  if (estimated && (i.shotsOnGoal < 4 || i.totalShots < 7))
    return { verdict: 'BLOQUEADO', score, blockReason: `DA estimado sem volume real suficiente (SoG=${i.shotsOnGoal}, chutes=${i.totalShots})` };
  if (estimated && i.pressure > 68 && i.shotsOnGoal < 5)
    return { verdict: 'BLOQUEADO', score, blockReason: 'Pressão elevada pode estar inflada por DA estimado; SoG insuficiente' };
  if (minute < 15 && i.shotsOnGoal < 3)
    return { verdict: 'BLOQUEADO', score, blockReason: 'Amostra ao vivo muito curta para confirmar pressão ofensiva' };
  if (sotRate < 0.60)
    return { verdict: 'BLOQUEADO', score, blockReason: `Ritmo de SoG insuficiente (${sotRate.toFixed(2)})` };
  if (daRate < 1.50)
    return { verdict: 'BLOQUEADO', score, blockReason: `Ritmo de ataques perigosos insuficiente (${daRate.toFixed(2)})` };
  if (i.pressure > 60 && i.dangerousAttacks <= 0)
    return { verdict: 'BLOQUEADO', score, blockReason: 'Pressão sem ataques perigosos' };
  if (score >= 55) return { verdict: 'CONFIRMADO', score, blockReason: null };
  if (score >= 30) return { verdict: 'NEUTRO', score, blockReason: null };
  return { verdict: 'BLOQUEADO', score, blockReason: `Score RMA ${score.toFixed(1)} abaixo de 30` };
}

export function buildRMAInput(
  homeStats: { dangerousAttacks?: number; totalShots?: number; shotsOnGoal?: number },
  awayStats: { dangerousAttacks?: number; totalShots?: number; shotsOnGoal?: number },
  minute: number,
  pressure: number,
): RMAInput {
  return {
    minute,
    pressure,
    dangerousAttacks: (homeStats.dangerousAttacks || 0) + (awayStats.dangerousAttacks || 0),
    totalShots: (homeStats.totalShots || 0) + (awayStats.totalShots || 0),
    shotsOnGoal: (homeStats.shotsOnGoal || 0) + (awayStats.shotsOnGoal || 0),
  };
}
