import { MatchData, MarketAnalysis, RiskProfile } from '@/types/match';

// ── POISSON ─────────────────────────────────────────
function poisson(lambda: number, k: number): number {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

function factorial(n: number): number {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}

// ── OVER (GOLOS) ───────────────────────────────────
function overProb(lambda: number, line: number): number {
  let prob = 0;
  for (let i = Math.floor(line) + 1; i <= 10; i++) {
    prob += poisson(lambda, i);
  }
  return prob;
}

// ── RESULTADO ──────────────────────────────────────
function resultProb(lambdaH: number, lambdaA: number) {
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

// ── LIMITADOR REAL (ANTI 99%) ──────────────────────
function clampProb(p: number): number {
  const value = p * 100;

  if (value > 85) return 85; // 🔥 limite realista
  if (value < 5) return 5;

  return Math.round(value);
}

// ── FUNÇÃO PRINCIPAL ───────────────────────────────
export function analyzeMarkets(match: MatchData): MarketAnalysis[] {
  const markets: MarketAnalysis[] = [];

  const md = match.modelData;

  if (!md || !md.homeGoalsAvg || !md.awayGoalsAvg) {
    return []; // sem dados = sem análise
  }

  // 🔥 AJUSTE REALISTA
  let lambdaH = md.homeGoalsAvg;
  let lambdaA = md.awayGoalsAvg;

  // 🔥 LIMITADOR DE LAMBDA (ESSENCIAL)
  lambdaH = Math.min(Math.max(lambdaH, 0.5), 2.2);
  lambdaA = Math.min(Math.max(lambdaA, 0.5), 2.0);

  const totalLambda = lambdaH + lambdaA;

  // ── GOLOS ──
  const over15 = overProb(totalLambda, 1.5);
  const over25 = overProb(totalLambda, 2.5);

  markets.push({
    market: 'Over 1.5 Gols',
    category: 'goals',
    probability: clampProb(over15),
    statisticalBasis: `λ=${totalLambda.toFixed(2)}`,
    risk: over15 > 0.7 ? 'Baixo' : over15 > 0.55 ? 'Médio' : 'Alto',
  });

  markets.push({
    market: 'Over 2.5 Gols',
    category: 'goals',
    probability: clampProb(over25),
    statisticalBasis: `λ=${totalLambda.toFixed(2)}`,
    risk: over25 > 0.65 ? 'Baixo' : over25 > 0.5 ? 'Médio' : 'Alto',
  });

  // ── RESULTADO ──
  const { home, draw, away } = resultProb(lambdaH, lambdaA);

  markets.push({
    market: `Vitória ${match.homeTeam}`,
    category: 'result',
    probability: clampProb(home),
    statisticalBasis: 'Poisson',
    risk: home > 0.6 ? 'Baixo' : home > 0.4 ? 'Médio' : 'Alto',
  });

  markets.push({
    market: `Vitória ${match.awayTeam}`,
    category: 'result',
    probability: clampProb(away),
    statisticalBasis: 'Poisson',
    risk: away > 0.6 ? 'Baixo' : away > 0.4 ? 'Médio' : 'Alto',
  });

  markets.push({
    market: '1X',
    category: 'result',
    probability: clampProb(home + draw),
    statisticalBasis: 'Poisson',
    risk: (home + draw) > 0.7 ? 'Baixo' : 'Médio',
  });

  markets.push({
    market: 'X2',
    category: 'result',
    probability: clampProb(away + draw),
    statisticalBasis: 'Poisson',
    risk: (away + draw) > 0.7 ? 'Baixo' : 'Médio',
  });

  return markets.sort((a, b) => b.probability - a.probability);
}

// ── PERFIL ─────────────────────────────────────────
export function getBestMarketForProfile(
  markets: MarketAnalysis[],
  profile: RiskProfile
): MarketAnalysis | null {

  const limits = {
    conservador: 75,
    moderado: 65,
    agressivo: 55,
  };

  return markets.find((m) => m.probability >= limits[profile]) || null;
}
