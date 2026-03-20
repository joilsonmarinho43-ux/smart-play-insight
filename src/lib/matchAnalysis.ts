import { MatchData, MarketAnalysis, RiskProfile } from '@/types/match';

// ─────────────────────────────────────────────
// 🔢 FUNÇÃO FATORIAL
// ─────────────────────────────────────────────
function factorial(n: number): number {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}

// ─────────────────────────────────────────────
// 📊 POISSON BASE
// ─────────────────────────────────────────────
function poisson(lambda: number, k: number): number {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

// ─────────────────────────────────────────────
// 🎯 PROBABILIDADE OVER (GOLS)
// ─────────────────────────────────────────────
function probOver(lambdaH: number, lambdaA: number, line: number): number {
  let prob = 0;

  for (let h = 0; h <= 5; h++) {
    for (let a = 0; a <= 5; a++) {
      if (h + a > line) {
        prob += poisson(lambdaH, h) * poisson(lambdaA, a);
      }
    }
  }

  return Math.max(0, Math.min(1, prob));
}

// ─────────────────────────────────────────────
// 🏆 PROBABILIDADE RESULTADO
// ─────────────────────────────────────────────
function resultProbabilities(lambdaH: number, lambdaA: number) {
  let home = 0, draw = 0, away = 0;

  for (let h = 0; h <= 5; h++) {
    for (let a = 0; a <= 5; a++) {
      const p = poisson(lambdaH, h) * poisson(lambdaA, a);

      if (h > a) home += p;
      else if (h === a) draw += p;
      else away += p;
    }
  }

  return { home, draw, away };
}

// ─────────────────────────────────────────────
// 🧠 FUNÇÃO PRINCIPAL
// ─────────────────────────────────────────────
export function analyzeMarkets(match: MatchData): MarketAnalysis[] {
  const markets: MarketAnalysis[] = [];

  // 🔥 PEGAR XG OU MÉDIA
  let xgH = match.metrics?.xG?.[0];
  let xgA = match.metrics?.xG?.[1];

  if (!xgH || !xgA) {
    xgH = match.modelData?.homeGoalsAvg || 1.2;
    xgA = match.modelData?.awayGoalsAvg || 1.0;
  }

  // 🚫 LIMITADOR (ANTI 99%)
  xgH = Math.min(Math.max(xgH, 0.5), 3);
  xgA = Math.min(Math.max(xgA, 0.5), 3);

  // ── MERCADOS DE GOLS ──
  const over15 = probOver(xgH, xgA, 1.5);
  const over25 = probOver(xgH, xgA, 2.5);

  markets.push({
    market: 'Over 1.5 Gols',
    category: 'goals',
    probability: Math.round(over15 * 100),
    statisticalBasis: `Poisson (λH=${xgH.toFixed(2)}, λA=${xgA.toFixed(2)})`,
    risk: over15 >= 0.75 ? 'Baixo' : over15 >= 0.60 ? 'Médio' : 'Alto',
  });

  markets.push({
    market: 'Over 2.5 Gols',
    category: 'goals',
    probability: Math.round(over25 * 100),
    statisticalBasis: `Poisson (λH=${xgH.toFixed(2)}, λA=${xgA.toFixed(2)})`,
    risk: over25 >= 0.70 ? 'Baixo' : over25 >= 0.55 ? 'Médio' : 'Alto',
  });

  // ── RESULTADO ──
  const { home, draw, away } = resultProbabilities(xgH, xgA);

  markets.push({
    market: `Vitória ${match.homeTeam}`,
    category: 'result',
    probability: Math.round(home * 100),
    statisticalBasis: 'Poisson',
    risk: home >= 0.60 ? 'Baixo' : home >= 0.45 ? 'Médio' : 'Alto',
  });

  markets.push({
    market: `Vitória ${match.awayTeam}`,
    category: 'result',
    probability: Math.round(away * 100),
    statisticalBasis: 'Poisson',
    risk: away >= 0.60 ? 'Baixo' : away >= 0.45 ? 'Médio' : 'Alto',
  });

  markets.push({
    market: '1X',
    category: 'result',
    probability: Math.round((home + draw) * 100),
    statisticalBasis: 'Poisson',
    risk: (home + draw) >= 0.75 ? 'Baixo' : 'Médio',
  });

  markets.push({
    market: 'X2',
    category: 'result',
    probability: Math.round((away + draw) * 100),
    statisticalBasis: 'Poisson',
    risk: (away + draw) >= 0.75 ? 'Baixo' : 'Médio',
  });

  return markets.sort((a, b) => b.probability - a.probability);
}

// ─────────────────────────────────────────────
// 🎯 PERFIL DE RISCO
// ─────────────────────────────────────────────
export function getBestMarketForProfile(
  markets: MarketAnalysis[],
  profile: RiskProfile
): MarketAnalysis | null {

  const thresholds: Record<RiskProfile, number> = {
    conservador: 75,
    moderado: 65,
    agressivo: 55,
  };

  const filtered = markets.filter(m => m.probability >= thresholds[profile]);

  return filtered.length ? filtered[0] : null;
      }
