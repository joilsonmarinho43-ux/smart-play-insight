// ═══════════════════════════════════════════════════════════════
// Dynamic Confidence Engine (TS port)
// Filtra/atenua confiança bruta usando:
//   • Decaimento temporal de Poisson:  w_pre(t) = e^(-k·t/90)
//   • Gatilho de momentum: SOT mínimo + pressão
//   • Desperation Index (DI): favorito perdendo/empatando ≥70'
//   • xG residual com fadiga defensiva do adversário
//   • Cap final 95%
// Saída: { confidence, lambdaDyn, di, blocked, reason }
// ═══════════════════════════════════════════════════════════════

export interface LiveSnapshot {
  minute: number;                  // 1..96
  homeGoals: number;
  awayGoals: number;
  sotTotal: number;                // chutes no alvo (ambos)
  shotsTotal: number;              // finalizações totais
  daTotal: number;                 // ataques perigosos totais
  pressure: number;                // 0..100 (PI atual)
  pressureRecent?: number;         // últimos 10 min (default = pressure)
  isHomeFavorite?: boolean;        // p/ DI; default false
  ratingFavMinusUnd?: number;      // diff rating/odds, p/ deficit
  xgEstimateTotal?: number;        // xG acumulado (opcional)
}

export interface DynamicConfResult {
  confidence: number;       // 0..95
  lambdaDyn: number;
  di: number;               // Desperation multiplier
  triggered: boolean;       // gatilho de momentum acionado
  decayWeight: number;
  reason: string;
}

const K_DECAY = 2.5;
const CONFIDENCE_CAP = 95;
const TRIGGER_PRESSURE = 60;
const TRIGGER_SOT = 1;

export function dynamicConfidence(
  rawConfidence: number,
  snap: LiveSnapshot
): DynamicConfResult {
  const t = Math.max(1, Math.min(96, snap.minute));
  const minutesLeft = Math.max(1, 90 - t);

  // 1) Decaimento temporal: probabilidade pré-jogo perde força com o tempo
  const decayWeight = Math.exp(-K_DECAY * (t / 90));

  // 2) Desperation Index (favorito perdendo/empatando ≥ 70')
  let di = 1.0;
  if (t >= 70 && (snap.isHomeFavorite ?? false)) {
    const deficit = Math.max(0, snap.awayGoals - snap.homeGoals);
    if (deficit >= 0 && snap.homeGoals <= snap.awayGoals) {
      di = 1.0 + 0.015 * (t - 70) + 0.10 * deficit;
      di = Math.min(di, 1.45);
    }
  }

  // 3) Gatilho de momentum
  const pRecent = snap.pressureRecent ?? snap.pressure;
  const triggered = pRecent >= TRIGGER_PRESSURE && snap.sotTotal >= TRIGGER_SOT;

  // 4) xG real-time + fadiga defensiva
  // Se chutes muito acima do esperado mas placar baixo → adversário cedendo
  const expectedShots = (t / 90) * 22; // baseline ~22 finalizações/jogo
  const fadiga = Math.max(0, Math.min(0.35, (snap.shotsTotal - expectedShots) / Math.max(expectedShots, 1) * 0.5));
  const xgTotal = snap.xgEstimateTotal ?? (snap.sotTotal * 0.30 + snap.daTotal * 0.012);
  const xgResid = xgTotal * (1 + fadiga) * di;
  const ratePerMin = Math.max(0.003, xgResid / Math.max(t, 1));
  const lambdaDyn = ratePerMin * minutesLeft;

  // 5) Confiança dinâmica (chance de pelo menos +1 gol até o fim)
  const dynProb = (1 - Math.exp(-lambdaDyn)) * 100;

  // 6) Combina raw com dinâmica:
  //   - peso pré-jogo decai com o tempo
  //   - peso live cresce com o tempo e ganha boost se gatilho ativo
  const wLive = (1 - decayWeight) * (triggered ? 1.05 : 0.85);
  const wPre = decayWeight;
  const blended = (rawConfidence * wPre + dynProb * wLive) / Math.max(wPre + wLive, 0.01);

  const confidence = Math.max(0, Math.min(CONFIDENCE_CAP, Math.round(blended * di)));

  const reason = `decay=${decayWeight.toFixed(2)} dyn=${dynProb.toFixed(0)}% λ=${lambdaDyn.toFixed(2)} DI=${di.toFixed(2)}${triggered ? ' [TRIGGER]' : ' [no-trigger]'}`;

  return { confidence, lambdaDyn, di, triggered, decayWeight, reason };
}

// Flag global (default ON, pode desligar via env)
export function isDynamicConfidenceEnabled(): boolean {
  const v = (globalThis as any).Deno?.env?.get?.('DYNAMIC_CONFIDENCE_ENABLED');
  return v !== 'false' && v !== '0';
}
