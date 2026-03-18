import { MatchData, MarketAnalysis, RiskProfile } from '@/types/match';

// ── Poisson helpers ──────────────────────────────────────────────
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

// ── Ajuste por variância ─────────────────────────────────────────
function adjustedMean(mean: number, variance: number): number {
  const cv = variance > 0 && mean > 0 ? Math.sqrt(variance) / mean : 0;
  return mean * (1 - cv * 0.05);
}

// ── Probabilidades de resultado ──────────────────────────────────
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

// ── Handicap Asiático ───────────────────────────────────────────
function asianHandicapProb(lambdaH: number, lambdaA: number, handicap: number): number {
  let prob = 0;
  const maxGoals = 8;

  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = poissonPmf(lambdaH, h) * poissonPmf(lambdaA, a);
      const adjusted = (h + handicap) - a;

      if (adjusted > 0) prob += p;
      else if (adjusted === 0) prob += p * 0.5;
    }
  }

  return prob;
}

// ── FUNÇÃO PRINCIPAL CORRIGIDA ──────────────────────────────────
export function analyzeMarkets(match: MatchData): MarketAnalysis[] {
  const markets: MarketAnalysis[] = [];

  // 🧠 FALLBACK GLOBAL
  const metrics = match.metrics || ({} as any);
  const modelData = match.modelData || ({} as any);

  // 🔥 XG (com fallback real)
  let [xgH, xgA] = metrics.xG || [0, 0];

  if (!xgH || !xgA) {
    xgH = modelData.homeGoalsAvg || 1.2;
    xgA = modelData.awayGoalsAvg || 1.0;
  }

  if (!xgH) xgH = 1.1;
  if (!xgA) xgA = 0.9;

  // ── GOALS ──
  const goalLines = [0.5, 1.5, 2.5, 3.5];

  for (const line of goalLines) {
    const prob = poissonOverProb(xgH, xgA, line);

    markets.push({
      market: `Over ${line} Gols`,
      category: 'goals',
      probability: round(prob * 100),
      statisticalBasis: `Poisson ajustado (λH=${xgH.toFixed(2)}, λA=${xgA.toFixed(2)})`,
      risk: prob >= 0.75 ? 'Baixo' : prob >= 0.55 ? 'Médio' : 'Alto',
    });
  }

  // ── CORNERS ──
  const adjCornersH = adjustedMean(
    modelData.homeCornersAvg || 4,
    modelData.homeCornersVariance || 1
  );

  const adjCornersA = adjustedMean(
    modelData.awayCornersAvg || 4,
    modelData.awayCornersVariance || 1
  );

  const lambdaCorners = adjCornersH + adjCornersA;

  const cornerLines = [4.5, 5.5, 6.5, 7.5, 8.5];

  for (const line of cornerLines) {
    const prob = poissonSingleOver(lambdaCorners, line);

    markets.push({
      market: `Over ${line} Escanteios`,
      category: 'corners',
      probability: round(prob * 100),
      statisticalBasis: `Modelo ajustado (μ=${lambdaCorners.toFixed(1)})`,
      risk: prob >= 0.75 ? 'Baixo' : prob >= 0.55 ? 'Médio' : 'Alto',
    });
  }

  // ── CARDS ──
  const adjCardsH = adjustedMean(
    modelData.homeCardsAvg || 2,
    modelData.homeCardsVariance || 1
  );

  const adjCardsA = adjustedMean(
    modelData.awayCardsAvg || 2,
    modelData.awayCardsVariance || 1
  );

  const lambdaCards = adjCardsH + adjCardsA;

  const cardLines = [0.5, 1.5, 2.5, 3.5];

  for (const line of cardLines) {
    const prob = poissonSingleOver(lambdaCards, line);

    markets.push({
      market: `Over ${line} Cartões`,
      category: 'cards',
      probability: round(prob * 100),
      statisticalBasis: `Modelo ajustado (μ=${lambdaCards.toFixed(1)})`,
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

// ── PERFIL DE RISCO ─────────────────────────────────────────────
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

  return eligible.length > 0 ? eligible[0] : null;
}

// ── UTIL ────────────────────────────────────────────────────────
function round(v: number): number {
  return Math.round(v * 10) / 10;
               }
