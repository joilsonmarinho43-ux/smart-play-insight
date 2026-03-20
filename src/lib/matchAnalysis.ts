import { MatchData, MarketAnalysis } from '@/types/match';

/**
 * Análise de mercados baseada em dados REAIS da API-Sports
 * Usa médias dos últimos 8 jogos (goalsFor, goalsAgainst) para calcular probabilidades
 * via distribuição de Poisson simplificada
 */

// Probabilidade Poisson P(X >= k) simplificada
function poissonOver(lambda: number, k: number): number {
  // P(X < k) = sum(e^-λ * λ^i / i!, i=0..k-1)
  let cumulative = 0;
  for (let i = 0; i < k; i++) {
    cumulative += (Math.exp(-lambda) * Math.pow(lambda, i)) / factorial(i);
  }
  return Math.max(0, Math.min(1, 1 - cumulative));
}

function factorial(n: number): number {
  if (n <= 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

export function analyzeMarkets(match: MatchData): MarketAnalysis[] {
  const markets: MarketAnalysis[] = [];
  const isLive = match.isLive;

  // Dados reais da API — médias dos últimos 8 jogos
  const hGF = match.modelData?.homeGoalsAvg || (match as any).homeStats?.goalsFor || 0;
  const aGF = match.modelData?.awayGoalsAvg || (match as any).awayStats?.goalsFor || 0;
  const hGA = (match as any).homeStats?.goalsAgainst || 0;
  const aGA = (match as any).awayStats?.goalsAgainst || 0;

  // Lambda Poisson: ataque do time vs defesa do oponente
  const leagueAvg = 1.35; // média de gols por equipe em ligas europeias
  const homeLambda = hGF > 0 && aGA > 0
    ? (hGF / leagueAvg) * (aGA / leagueAvg) * leagueAvg
    : hGF || 1.2;
  const awayLambda = aGF > 0 && hGA > 0
    ? (aGF / leagueAvg) * (hGA / leagueAvg) * leagueAvg
    : aGF || 0.9;

  const totalLambda = homeLambda + awayLambda;

  // Live stats
  const lH = (match as any).stats?.home || { dangerousAttacks: 0, corners: 0, possession: 0, shotsOnGoal: 0 };
  const lA = (match as any).stats?.away || { dangerousAttacks: 0, corners: 0, possession: 0, shotsOnGoal: 0 };

  // --- GOLS (Poisson real) ---
  if (isLive) {
    const liveExpected = ((lH.dangerousAttacks + lA.dangerousAttacks) / 20) + ((lH.shotsOnGoal + lA.shotsOnGoal) * 0.2);
    const o15 = Math.min(95, Math.max(30, liveExpected * 35));
    const o25 = Math.min(90, Math.max(15, liveExpected * 22));
    markets.push({ market: 'Over 1.5 Gols', probability: Math.floor(o15), risk: o15 > 80 ? 'Baixo' : 'Médio', category: 'goals' });
    markets.push({ market: 'Over 2.5 Gols', probability: Math.floor(o25), risk: o25 > 65 ? 'Médio' : 'Alto', category: 'goals' });
  } else {
    const o15Poisson = poissonOver(totalLambda, 2);
    const o25Poisson = poissonOver(totalLambda, 3);
    const o15Prob = Math.round(o15Poisson * 100);
    const o25Prob = Math.round(o25Poisson * 100);
    markets.push({ market: 'Over 1.5 Gols', probability: o15Prob, risk: o15Prob > 80 ? 'Baixo' : 'Médio', category: 'goals' });
    markets.push({ market: 'Over 2.5 Gols', probability: o25Prob, risk: o25Prob > 65 ? 'Médio' : 'Alto', category: 'goals' });
  }

  // Ambas Marcam (BTTS)
  if (isLive) {
    const btts = lH.shotsOnGoal > 0 && lA.shotsOnGoal > 0 ? 75 : 40;
    markets.push({ market: 'Ambas Marcam', probability: btts, risk: 'Médio', category: 'goals' });
  } else {
    // P(home scores) * P(away scores)
    const pHomeScores = 1 - Math.exp(-homeLambda);
    const pAwayScores = 1 - Math.exp(-awayLambda);
    const bttsProb = Math.round(pHomeScores * pAwayScores * 100);
    markets.push({ market: 'Ambas Marcam', probability: bttsProb, risk: bttsProb > 65 ? 'Médio' : 'Alto', category: 'goals' });
  }

  // Over 0.5 HT (Gol no 1° Tempo)
  if (isLive) {
    const htLive = Math.min(90, Math.max(40, (lH.shotsOnGoal + lA.shotsOnGoal) * 15));
    markets.push({ market: 'Over 0.5 HT', probability: Math.floor(htLive), risk: 'Baixo', category: 'goals' });
  } else {
    const htLambda = totalLambda * 0.45; // ~45% dos gols no 1° tempo
    const htProb = Math.round((1 - Math.exp(-htLambda)) * 100);
    markets.push({ market: 'Over 0.5 HT', probability: htProb, risk: htProb > 75 ? 'Baixo' : 'Médio', category: 'goals' });
  }

  // --- ESCANTEIOS ---
  const hCorners = match.modelData?.homeCornersAvg || (match.metrics?.corners?.[0] || 5);
  const aCorners = match.modelData?.awayCornersAvg || (match.metrics?.corners?.[1] || 4);
  const cornerTotal = isLive
    ? (lH.corners + lA.corners) + ((lH.dangerousAttacks + lA.dangerousAttacks) * 0.1)
    : hCorners + aCorners;

  const o75CornersProb = isLive
    ? Math.min(95, Math.floor(30 + cornerTotal * 5))
    : Math.round(poissonOver(cornerTotal, 8) * 100);
  markets.push({ market: 'Over 7.5 Cantos', probability: o75CornersProb, risk: 'Baixo', category: 'corners' });

  // --- CHANCE DUPLA ---
  let dcProb: number;
  if (isLive) {
    dcProb = lH.dangerousAttacks > lA.dangerousAttacks ? 72 : 65;
  } else {
    // P(home win) + P(draw)
    const stronger = homeLambda >= awayLambda;
    const strongLambda = stronger ? homeLambda : awayLambda;
    const weakLambda = stronger ? awayLambda : homeLambda;
    dcProb = Math.min(88, Math.round(55 + (strongLambda - weakLambda) * 12));
  }
  const dcLabel = homeLambda >= awayLambda ? '1X (Casa ou Empate)' : 'X2 (Empate ou Fora)';
  markets.push({ market: dcLabel, probability: dcProb, risk: 'Baixo', category: 'result' });

  return markets;
}

export function getBestMarketForProfile(markets: MarketAnalysis[], profile: 'conservador' | 'moderado' | 'agressivo') {
  const thresholds = { conservador: 75, moderado: 65, agressivo: 55 };
  const minProb = thresholds[profile];
  const filtered = markets.filter(m => m.probability >= minProb);
  return filtered.sort((a, b) => b.probability - a.probability)[0] || null;
}
