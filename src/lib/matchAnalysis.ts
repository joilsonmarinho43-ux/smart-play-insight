import { MatchData, MarketAnalysis, RiskProfile } from '@/types/match';

// ── POISSON BASE ────────────────────────────────────────────────
function poissonPmf(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;

  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logP -= Math.log(i);

  return Math.exp(logP);
}

function poissonOverProb(lambda1: number, lambda2: number, threshold: number): number {
  let pUnder = 0;
  const n = Math.floor(threshold);

  for (let total = 0; total <= n; total++) {
    for (let h = 0; h <= total; h++) {
      pUnder += poissonPmf(lambda1, h) * poissonPmf(lambda2, total - h);
    }
  }

  return Math.max(0, Math.min(1, 1 - pUnder));
}

function poissonSingleOver(lambda: number, threshold: number): number {
  let pUnder = 0;
  const n = Math.floor(threshold);

  for (let k = 0; k <= n; k++) {
    pUnder += poissonPmf(lambda, k);
  }

  return Math.max(0, Math.min(1, 1 - pUnder));
}

// ── AJUSTE DE VARIÂNCIA ─────────────────────────────────────────
function adjustedMean(mean: number, variance: number): number {
  if (!mean || mean <= 0) return 0.1;

  const cv = variance > 0 ? Math.sqrt(variance) / mean : 0;
  return mean * (1 - cv * 0.05);
}

// ── RESULTADOS ──────────────────────────────────────────────────
function resultProbabilities(lambdaH: number, lambdaA: number) {
  let pHome = 0, pDraw = 0, pAway = 0;
  const maxGoals = 8;

  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = poissonPmf(lambdaH, h) * poissonPmf(lambdaA, a);

      if (h > a) pHome += p;
      else if (h === a) pDraw += p;
      else pAway += p;
    }
  }

  return { pHome, pDraw, pAway };
}

// ── FUNÇÃO PRINCIPAL (AGORA REAL) ───────────────────────────────
export function analyzeMarkets(match: MatchData): MarketAnalysis[] {
  const markets: MarketAnalysis[] = [];

  const metrics = match.metrics || ({} as any);
  const modelData = match.modelData || ({} as any);

  // 🔥 PEGAR XG REAL
  let [xgH, xgA] = metrics.xG || [null, null];

  // 🔥 FALLBACK INTELIGENTE
  if (xgH === null || xgA === null) {
    if (modelData.homeGoalsAvg && modelData.awayGoalsAvg) {
      xgH = modelData.homeGoalsAvg;
      xgA = modelData.awayGoalsAvg;
    } else {
      return []; // ❗ SEM DADO = NÃO ANALISA
    }
  }

  // 🔥 LIMITADOR (ANTI 99%)
  xgH = Math.min(Math.max(xgH, 0.3), 3.5);
  xgA = Math.min(Math.max(xgA, 0.3), 3.5);

  // ── GOLOS ──
  const goalLines = [0.5, 1.5, 2.5];

  for (const line of goalLines) {
    const prob = poissonOverProb(xgH, xgA, line);

    markets.push({
      market: `Over ${line} Gols`,
      category: 'goals',
      probability: round(prob * 100),
      statisticalBasis: `Poisson real (λH=${xgH.toFixed(2)}, λA=${xgA.toFixed(2)})`,
      risk: prob >= 0.75 ? 'Baixo' : prob >= 0.55 ? 'Médio' : 'Alto',
    });
  }

  // ── ESCANTEIOS ──
  const lambdaCorners =
    adjustedMean(modelData.homeCornersAvg || 4, modelData.homeCornersVariance || 1) +
    adjustedMean(modelData.awayCornersAvg || 4, modelData.awayCornersVariance || 1);

  for (const line of [5.5, 6.5, 7.5]) {
    const prob = poissonSingleOver(lambdaCorners, line);

    markets.push({
      market: `Over ${line} Escanteios`,
      category: 'corners',
      probability: round(prob * 100),
      statisticalBasis: `Modelo (μ=${lambdaCorners.toFixed(1)})`,
      risk: prob >= 0.75 ? 'Baixo' : prob >= 0.55 ? 'Médio' : 'Alto',
    });
  }

  // ── CARTÕES ──
  const lambdaCards =
    adjustedMean(modelData.homeCardsAvg || 2, modelData.homeCardsVariance || 1) +
    adjustedMean(modelData.awayCardsAvg || 2, modelData.awayCardsVariance || 1);

  for (const line of [2.5, 3.5]) {
    const prob = poissonSingleOver(lambdaCards, line);

    markets.push({
      market: `Over ${line} Cartões`,
      category: 'cards',
      probability: round(prob * 100),
      statisticalBasis: `Modelo (μ=${lambdaCards.toFixed(1)})`,
      risk: prob >= 0.75 ? 'Baixo' : prob >= 0.55 ? 'Médio' : 'Alto',
    });
  }

  // ── RESULTADO ──
  const { pHome, pDraw, pAway } = resultProbabilities(xgH, xgA);

  markets.push({
    market: `Vitória ${match.homeTeam}`,
    category: 'result',
    probability: round(pHome * 100),
    statisticalBasis: `Poisson`,
    risk: pHome >= 0.6 ? 'Baixo' : pHome >= 0.4 ? 'Médio' : 'Alto',
  });

  markets.push({
    market: `Vitória ${match.awayTeam}`,
    category: 'result',
    probability: round(pAway * 100),
    statisticalBasis: `Poisson`,
    risk: pAway >= 0.6 ? 'Baixo' : pAway >= 0.4 ? 'Médio' : 'Alto',
  });

  markets.push({
    market: `1X`,
    category: 'result',
    probability: round((pHome + pDraw) * 100),
    statisticalBasis: `Poisson`,
    risk: (pHome + pDraw) >= 0.75 ? 'Baixo' : (pHome + pDraw) >= 0.55 ? 'Médio' : 'Alto',
  });

  markets.push({
    market: `X2`,
    category: 'result',
    probability: round((pAway + pDraw) * 100),
    statisticalBasis: `Poisson`,
    risk: (pAway + pDraw) >= 0.75 ? 'Baixo' : (pAway + pDraw) >= 0.55 ? 'Médio' : 'Alto',
  });

  return markets.sort((a, b) => b.probability - a.probability);
}

// ── PERFIL ─────────────────────────────────────────────────────
export function getBestMarketForProfile(
  markets: MarketAnalysis[],
  profile: RiskProfile
): MarketAnalysis | null {

  const thresholds: Record<RiskProfile, number> = {
    conservador: 75,
    moderado: 65,
    agressivo: 55,
  };

  const filtered = markets.filter((m) => m.probability >= thresholds[profile]);

  return filtered.length ? filtered[0] : null;
}

// ── UTIL ───────────────────────────────────────────────────────
function round(v: number): number {
  return Math.round(v * 10) / 10;
      }
