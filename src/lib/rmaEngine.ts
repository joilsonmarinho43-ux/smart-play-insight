/**
 * RMA ENGINE — Ritmo, Momento e Agressividade
 * 
 * Camada de validação paralela que classifica sinais como
 * CONFIRMADO, BLOQUEADO ou NEUTRO sem alterar a lógica existente.
 * 
 * Modo Shadow: apenas registra decisões, sem interferir no usuário.
 */

export type RMAVerdict = 'CONFIRMADO' | 'BLOQUEADO' | 'NEUTRO';

export interface RMAResult {
  verdict: RMAVerdict;
  score: number;
  ap_norm: number;
  f_norm: number;
  sot_norm: number;
  acceleration: number;
  blockReason: string | null;
}

export interface RMAInput {
  /** Minuto atual do jogo (>= 1) */
  minute: number;
  /** Índice de pressão 0-100 */
  pressure: number;
  /** Ataques perigosos acumulados */
  dangerousAttacks: number;
  /** Total de finalizações */
  totalShots: number;
  /** Finalizações no gol */
  shotsOnTarget: number;
  /** Ataques perigosos nos últimos 5 min (opcional, para aceleração) */
  recentDA?: number;
  /** Ataques perigosos nos 5 min anteriores (opcional, para aceleração) */
  previousDA?: number;
}

/**
 * Calcula o score RMA e classifica o sinal.
 */
export function evaluateRMA(input: RMAInput): RMAResult {
  const safeMinute = Math.max(input.minute, 1);

  // Normalize per-minute rates × 10
  const ap_norm = (input.dangerousAttacks / safeMinute) * 10;
  const f_norm = (input.totalShots / safeMinute) * 10;
  const sot_norm = (input.shotsOnTarget / safeMinute) * 10;

  // Composite score
  let rma_score =
    (input.pressure * 0.4) +
    (ap_norm * 0.35) +
    (f_norm * 0.15) +
    (sot_norm * 0.10);

  // Acceleration (reforço / enfraquecimento)
  const acceleration = (input.recentDA ?? 0) - (input.previousDA ?? 0);

  // ── Hard-block: only obvious fake pressure ──
  if (input.pressure > 60 && input.dangerousAttacks === 0 && input.shotsOnTarget === 0) {
    return { verdict: 'BLOQUEADO', score: rma_score, ap_norm, f_norm, sot_norm, acceleration, blockReason: 'Pressão fake: pressão alta sem atividade' };
  }

  // Apply acceleration bonus/penalty (±5 pts max)
  if (acceleration > 0) {
    rma_score += Math.min(acceleration * 2, 5);
  } else if (acceleration < 0) {
    rma_score += Math.max(acceleration * 2, -5);
  }

  // ── Classification with adjusted thresholds ──
  let verdict: RMAVerdict;
  if (rma_score > 40) {
    verdict = 'CONFIRMADO';
  } else if (rma_score >= 25) {
    verdict = 'NEUTRO';
  } else {
    verdict = 'BLOQUEADO';
  }

  return { verdict, score: Math.round(rma_score * 100) / 100, ap_norm: Math.round(ap_norm * 100) / 100, f_norm: Math.round(f_norm * 100) / 100, sot_norm: Math.round(sot_norm * 100) / 100, acceleration, blockReason: verdict === 'BLOQUEADO' ? `Score ${Math.round(rma_score)} < 25` : null };
}

/**
 * Helper: build RMAInput from typical live match stats.
 */
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
    shotsOnTarget: (homeStats.shotsOnGoal || 0) + (awayStats.shotsOnGoal || 0),
  };
}
