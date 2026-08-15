// ════════════════════════════════════════════════════════════════
// goalProjection — projeção Poisson de gols restantes
// Usado por auto-mode-server e scanner-pro-server para validar
// se um jogo 0x0 ainda tem tempo/ritmo suficiente para 2 gols
// (Over 1.5 FT entrando em 0x0 exige DOIS gols).
// ════════════════════════════════════════════════════════════════

export interface GoalProjectionInput {
  minute: number;
  sog: number;          // chutes no gol (total)
  totalShots: number;   // chutes totais
  da: number;           // ataques perigosos (total)
  corners: number;
  pressure: number;     // 0-100
}

export interface GoalProjection {
  xgRatePerMin: number;
  lambdaRemaining: number;
  probAtLeast1: number;
  probAtLeast2: number;
}

/**
 * Taxa de xG por minuto derivada de eventos reais + λ restante até o min 90.
 * Pesos calibrados: SoG ≈ 0.09 xG, chute fora ≈ 0.025, DA ≈ 0.012, escanteio ≈ 0.022.
 */
export function projectGoals(i: GoalProjectionInput): GoalProjection {
  const min = Math.max(1, i.minute);
  const offTarget = Math.max(0, (i.totalShots || 0) - (i.sog || 0));
  const xgSoFar =
    (i.sog || 0) * 0.09 +
    offTarget * 0.025 +
    (i.da || 0) * 0.012 +
    (i.corners || 0) * 0.022;

  let ratePerMin = xgSoFar / min;

  // Ajuste leve por pressão atual (jogo esquentando ou esfriando)
  const pressureFactor = 0.85 + Math.min(0.35, (i.pressure || 0) / 200);
  ratePerMin *= pressureFactor;

  const remaining = Math.max(0, 90 - i.minute);
  const lambda = ratePerMin * remaining;

  const p0 = Math.exp(-lambda);
  const p1 = lambda * p0;

  return {
    xgRatePerMin: Number(ratePerMin.toFixed(4)),
    lambdaRemaining: Number(lambda.toFixed(2)),
    probAtLeast1: Number((1 - p0).toFixed(3)),
    probAtLeast2: Number((1 - p0 - p1).toFixed(3)),
  };
}
