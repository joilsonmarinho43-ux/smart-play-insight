export type RMAVerdict = 'CONFIRMADO' | 'BLOQUEADO' | 'NEUTRO';

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

export interface RMAResult {
  verdict: RMAVerdict;
  score: number;
  blockReason?: string;
}

/**
 * Escala única 0-100 para todos os emissores. Os complementos de liga e
 * momentum só entram depois dos indicadores normalizados e têm peso limitado.
 */
export function evaluateRMA(i: RMAInput): RMAResult {
  const minute = Math.max(1, i.minute);
  const daRate = (i.dangerousAttacks / minute) * 10;
  const shotsRate = (i.totalShots / minute) * 10;
  const sotRate = (i.shotsOnGoal / minute) * 10;
  const qualityPenalty = i.daEstimated ? 5 : 0;

  const raw =
    i.pressure * 0.30 +
    daRate * 0.35 +
    shotsRate * 0.15 +
    sotRate * 0.20 +
    Math.max(-5, Math.min(6, i.leagueWeight ?? 0)) +
    Math.max(-6, Math.min(6, i.momentumDelta ?? 0)) -
    qualityPenalty;
  const score = Math.round(Math.max(0, Math.min(100, raw)) * 100) / 100;

  if (i.daEstimated && i.pressure > 70 && i.shotsOnGoal <= 2) {
    return { verdict: 'BLOQUEADO', score, blockReason: 'Pressão alta baseada em DA estimado e poucas finalizações no alvo' };
  }
  if (sotRate < 0.6) {
    return { verdict: 'BLOQUEADO', score, blockReason: `Ritmo de SoG insuficiente (${sotRate.toFixed(2)})` };
  }
  if (daRate < 1.5) {
    return { verdict: 'BLOQUEADO', score, blockReason: `Ritmo de ataques perigosos insuficiente (${daRate.toFixed(2)})` };
  }
  if (i.pressure > 60 && i.dangerousAttacks <= 0) {
    return { verdict: 'BLOQUEADO', score, blockReason: 'Pressão sem ataques perigosos' };
  }

  if (score > 40) return { verdict: 'CONFIRMADO', score };
  if (score >= 20) return { verdict: 'NEUTRO', score };
  return { verdict: 'BLOQUEADO', score, blockReason: `Score RMA ${score.toFixed(1)} abaixo de 20` };
}