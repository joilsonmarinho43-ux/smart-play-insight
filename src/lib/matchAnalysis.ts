import { MatchData, MarketAnalysis, RiskProfile } from '@/types/match';

// ── Poisson helpers ──────────────────────────────────────────────
function poissonPmf(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

/** P(X+Y > n) where X~Poisson(λ1), Y~Poisson(λ2) */
function poissonOverProb(lambda1: number, lambda2: number, threshold: number): number {
  let pUnder = 0;
  const n = Math.floor(threshold); // e.g. 2 for Over 2.5
  for (let total = 0; total <= n; total++) {
    for (let h = 0; h <= total; h++) {
      pUnder += poissonPmf(lambda1, h) * poissonPmf(lambda2, total - h);
    }
  }
  return Math.max(0, Math.min(1, 1 - pUnder));
}

/** P(X > n) where X~Poisson(λ) */
function poissonSingleOver(lambda: number, threshold: number): number {
  let pUnder = 0;
  const n = Math.floor(threshold);
  for (let k = 0; k <= n; k++) {
    pUnder += poissonPmf(lambda, k);
  }
  return Math.max(0, Math.min(1, 1 - pUnder));
}

// ── Weighted average model with variance adjustment ─────────────
/** Adjusts mean using variance — higher variance reduces confidence */
function adjustedMean(mean: number, variance: number): number {
  const cv = variance > 0 && mean > 0 ? Math.sqrt(variance) / mean : 0;
  // Penalize high variance slightly
  return mean * (1 - cv * 0.05);
}

// ── Result probabilities via Poisson ────────────────────────────
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

// ── Asian Handicap probabilities ────────────────────────────────
function asianHandicapProb(lambdaH: number, lambdaA: number, handicap: number): number {
  // handicap is from home perspective: -0.5 means home must win by 1+
  let prob = 0;
  const maxGoals = 8;
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = poissonPmf(lambdaH, h) * poissonPmf(lambdaA, a);
      const adjusted = (h + handicap) - a;
      if (adjusted > 0) prob += p;
      else if (adjusted === 0) prob += p * 0.5; // push = half
    }
  }
  return prob;
}

// ── Main analysis function ──────────────────────────────────────
export function analyzeMarkets(match: MatchData): MarketAnalysis[] {
  const { metrics, modelData } = match;
  const [xgH, xgA] = metrics.xG;
  const markets: MarketAnalysis[] = [];

  // ── GOALS (Poisson) ──
  const lambdaH = xgH;
  const lambdaA = xgA;
  const goalLines = [0.5, 1.5, 2.5, 3.5];

  for (const line of goalLines) {
    const prob = poissonOverProb(lambdaH, lambdaA, line);
    markets.push({
      market: `Over ${line} Gols`,
      category: 'goals',
      probability: round(prob * 100),
      statisticalBasis: `Poisson (λ casa=${lambdaH}, λ fora=${lambdaA})`,
      risk: prob >= 0.75 ? 'Baixo' : prob >= 0.55 ? 'Médio' : 'Alto',
    });
  }

  // ── CORNERS (weighted mean + variance) ──
  const adjCornersH = adjustedMean(modelData.homeCornersAvg, modelData.homeCornersVariance);
  const adjCornersA = adjustedMean(modelData.awayCornersAvg, modelData.awayCornersVariance);
  const lambdaCornersTotal = adjCornersH + adjCornersA;
  const cornerLines = [4.5, 5.5, 6.5, 7.5, 8.5];

  for (const line of cornerLines) {
    const prob = poissonSingleOver(lambdaCornersTotal, line);
    markets.push({
      market: `Over ${line} Escanteios`,
      category: 'corners',
      probability: round(prob * 100),
      statisticalBasis: `Média ponderada ajustada (μ=${lambdaCornersTotal.toFixed(1)})`,
      risk: prob >= 0.75 ? 'Baixo' : prob >= 0.55 ? 'Médio' : 'Alto',
    });
  }

  // ── CARDS (weighted mean + variance) ──
  const adjCardsH = adjustedMean(modelData.homeCardsAvg, modelData.homeCardsVariance);
  const adjCardsA = adjustedMean(modelData.awayCardsAvg, modelData.awayCardsVariance);
  const lambdaCardsTotal = adjCardsH + adjCardsA;
  const cardLines = [0.5, 1.5, 2.5, 3.5];

  for (const line of cardLines) {
    const prob = poissonSingleOver(lambdaCardsTotal, line);
    markets.push({
      market: `Over ${line} Cartões`,
      category: 'cards',
      probability: round(prob * 100),
      statisticalBasis: `Média ponderada ajustada (μ=${lambdaCardsTotal.toFixed(1)})`,
      risk: prob >= 0.75 ? 'Baixo' : prob >= 0.55 ? 'Médio' : 'Alto',
    });
  }

  // ── RESULT (Poisson-based) ──
  const { pHome, pDraw, pAway } = resultProbabilities(lambdaH, lambdaA);

  markets.push({
    market: `Vitória ${match.homeTeam}`,
    category: 'result',
    probability: round(pHome * 100),
    statisticalBasis: `Poisson resultado (λH=${lambdaH}, λA=${lambdaA})`,
    risk: pHome >= 0.6 ? 'Baixo' : pHome >= 0.4 ? 'Médio' : 'Alto',
  });
  markets.push({
    market: `Vitória ${match.awayTeam}`,
    category: 'result',
    probability: round(pAway * 100),
    statisticalBasis: `Poisson resultado (λH=${lambdaH}, λA=${lambdaA})`,
    risk: pAway >= 0.6 ? 'Baixo' : pAway >= 0.4 ? 'Médio' : 'Alto',
  });

  // Chance Dupla
  markets.push({
    market: `1X (${match.homeTeam} ou Empate)`,
    category: 'result',
    probability: round((pHome + pDraw) * 100),
    statisticalBasis: `Poisson CD (P1=${round(pHome*100)}% + PX=${round(pDraw*100)}%)`,
    risk: (pHome + pDraw) >= 0.75 ? 'Baixo' : (pHome + pDraw) >= 0.55 ? 'Médio' : 'Alto',
  });
  markets.push({
    market: `X2 (${match.awayTeam} ou Empate)`,
    category: 'result',
    probability: round((pAway + pDraw) * 100),
    statisticalBasis: `Poisson CD (P2=${round(pAway*100)}% + PX=${round(pDraw*100)}%)`,
    risk: (pAway + pDraw) >= 0.75 ? 'Baixo' : (pAway + pDraw) >= 0.55 ? 'Médio' : 'Alto',
  });

  // Asian Handicap
  const ahLines: { label: string; handicap: number }[] = [
    { label: `${match.homeTeam} -0.5`, handicap: -0.5 },
    { label: `${match.homeTeam} -1.0`, handicap: -1.0 },
    { label: `${match.homeTeam} +0.5`, handicap: 0.5 },
  ];
  for (const ah of ahLines) {
    const prob = asianHandicapProb(lambdaH, lambdaA, ah.handicap);
    markets.push({
      market: `Handicap ${ah.label}`,
      category: 'result',
      probability: round(prob * 100),
      statisticalBasis: `Poisson AH (λH=${lambdaH}, λA=${lambdaA})`,
      risk: prob >= 0.65 ? 'Baixo' : prob >= 0.45 ? 'Médio' : 'Alto',
    });
  }

  return markets.sort((a, b) => b.probability - a.probability);
}

export function getBestMarketForProfile(
  markets: MarketAnalysis[],
  profile: RiskProfile
): MarketAnalysis | null {
  const minProb: Record<RiskProfile, number> = {
    conservador: 75,
    moderado: 65,
    agressivo: 55,
  };
  const threshold = minProb[profile];
  const eligible = markets.filter((m) => m.probability >= threshold);
  return eligible.length > 0 ? eligible[0] : null; // already sorted desc
}

function round(v: number): number {
  return Math.round(v * 10) / 10;
}
