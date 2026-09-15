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
 * Escala única 0-100 para todos os emissores.
 *
 * HARDENING 2026-09:
 * - DA estimado não pode sustentar sozinho um sinal.
 * - SoG/volume real passam a ter precedência sobre pressão derivada.
 * - sinais muito precoces recebem exigência adicional.
 */
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

  if (estimated && (i.shotsOnGoal < 4 || i.totalShots < 7)) {
    return {
      verdict: 'BLOQUEADO',
      score,
      blockReason: `DA estimado sem volume real suficiente (SoG=${i.shotsOnGoal}, chutes=${i.totalShots})`,
    };
  }

  if (estimated && i.pressure > 68 && i.shotsOnGoal < 5) {
    return {
      verdict: 'BLOQUEADO',
      score,
      blockReason: 'Pressão elevada pode estar inflada por DA estimado; SoG insuficiente',
    };
  }

  if (minute < 15 && i.shotsOnGoal < 3) {
    return {
      verdict: 'BLOQUEADO',
      score,
      blockReason: 'Amostra ao vivo muito curta para confirmar pressão ofensiva',
    };
  }

  if (sotRate < 0.60) {
    return { verdict: 'BLOQUEADO', score, blockReason: `Ritmo de SoG insuficiente (${sotRate.toFixed(2)})` };
  }
  if (daRate < 1.50) {
    return { verdict: 'BLOQUEADO', score, blockReason: `Ritmo de ataques perigosos insuficiente (${daRate.toFixed(2)})` };
  }
  if (i.pressure > 60 && i.dangerousAttacks <= 0) {
    return { verdict: 'BLOQUEADO', score, blockReason: 'Pressão sem ataques perigosos' };
  }

  if (score >= 55) return { verdict: 'CONFIRMADO', score };
  if (score >= 30) return { verdict: 'NEUTRO', score };
  return { verdict: 'BLOQUEADO', score, blockReason: `Score RMA ${score.toFixed(1)} abaixo de 30` };
}
