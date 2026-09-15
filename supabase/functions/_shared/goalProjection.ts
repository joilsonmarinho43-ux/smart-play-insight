// goalProjection — projeção Poisson de gols restantes
// Usado por auto-mode-server e scanner-pro-server para validar
// se um jogo 0x0 ainda tem tempo/ritmo suficiente para 2 gols.

export interface GoalProjectionInput {
  minute: number;
  sog: number;
  totalShots: number;
  da: number;
  corners: number;
  pressure: number;
  daEstimated?: boolean;
}

export interface GoalProjection {
  xgRatePerMin: number;
  lambdaRemaining: number;
  probAtLeast1: number;
  probAtLeast2: number;
  evidenceQuality: 'real' | 'mixed' | 'weak';
}

/**
 * Projeção conservadora.
 *
 * Eventos ao vivo são parcialmente correlacionados. A projeção não deve
 * transformar uma amostra curta em um lambda exagerado. DA sem garantia de
 * origem é tratado como estimado por padrão.
 */
export function projectGoals(i: GoalProjectionInput): GoalProjection {
  const min = Math.max(1, i.minute);
  const sog = Math.max(0, i.sog || 0);
  const totalShots = Math.max(0, i.totalShots || 0);
  const da = Math.max(0, i.da || 0);
  const corners = Math.max(0, i.corners || 0);
  const daEstimated = i.daEstimated !== false;

  const offTarget = Math.max(0, totalShots - sog);
  const daWeight = daEstimated ? 0.004 : 0.012;

  const xgSoFar =
    sog * 0.09 +
    offTarget * 0.025 +
    da * daWeight +
    corners * 0.018;

  const observedRate = xgSoFar / min;
  const priorRate = 2.55 / 90;
  const evidenceWeight = Math.min(0.74, Math.max(0.22, min / (min + 22)));
  let ratePerMin = observedRate * evidenceWeight + priorRate * (1 - evidenceWeight);

  // Limite superior conservador para impedir picos artificiais no início.
  ratePerMin = Math.min(ratePerMin, 0.075);

  const remaining = Math.max(0, 90 - i.minute);
  const lambda = ratePerMin * remaining;
  const p0 = Math.exp(-lambda);
  const p1 = lambda * p0;

  const evidenceQuality = daEstimated
    ? (sog >= 4 && totalShots >= 7 ? 'mixed' : 'weak')
    : 'real';

  return {
    xgRatePerMin: Number(ratePerMin.toFixed(4)),
    lambdaRemaining: Number(lambda.toFixed(2)),
    probAtLeast1: Number((1 - p0).toFixed(3)),
    probAtLeast2: Number((1 - p0 - p1).toFixed(3)),
    evidenceQuality,
  };
}
