import { MatchData, MarketAnalysis } from '@/types/match';

export function analyzeMarkets(match: MatchData): MarketAnalysis[] {
  const markets: MarketAnalysis[] = [];
  
  const isLive = match.isLive;
  
  // Usa modelData (médias reais) quando disponível, senão fallback para homeStats/awayStats
  const modelData = match.modelData;
  const hGoalsAvg = modelData?.homeGoalsAvg || (match as any).homeStats?.goalsFor || 0;
  const aGoalsAvg = modelData?.awayGoalsAvg || (match as any).awayStats?.goalsFor || 0;
  const hGoalsAgainst = (match as any).homeStats?.goalsAgainst || aGoalsAvg * 0.8;
  const aGoalsAgainst = (match as any).awayStats?.goalsAgainst || hGoalsAvg * 0.8;

  // Live stats
  const lH = (match as any).stats?.home || { dangerousAttacks: 0, corners: 0, possession: 0, shotsOnGoal: 0 };
  const lA = (match as any).stats?.away || { dangerousAttacks: 0, corners: 0, possession: 0, shotsOnGoal: 0 };

  // --- GOLS (Poisson simplificado baseado em médias reais) ---
  const expectedGoals = isLive 
    ? ((lH.dangerousAttacks + lA.dangerousAttacks) / 20) + ((lH.shotsOnGoal + lA.shotsOnGoal) * 0.2)
    : (hGoalsAvg + aGoalsAgainst + aGoalsAvg + hGoalsAgainst) / 2;

  // Over 1.5 Gols - baseado em expectativa de gols
  const o15Prob = Math.min(94, Math.max(45, expectedGoals * 35));
  markets.push({ 
    market: 'Over 1.5 Gols', 
    probability: Math.floor(o15Prob), 
    risk: o15Prob > 85 ? 'Baixo' : 'Médio', 
    category: 'goals' 
  });

  // Over 2.5 Gols
  const o25Prob = Math.min(88, Math.max(20, expectedGoals * 22));
  markets.push({ 
    market: 'Over 2.5 Gols', 
    probability: Math.floor(o25Prob), 
    risk: o25Prob > 70 ? 'Médio' : 'Alto', 
    category: 'goals' 
  });

  // Ambas Marcam (BTTS) 
  const bttsProb = isLive 
    ? (lH.shotsOnGoal > 0 && lA.shotsOnGoal > 0 ? 75 : 40)
    : (hGoalsAvg > 1 && aGoalsAvg > 1 ? 72 : hGoalsAvg > 0.8 && aGoalsAvg > 0.8 ? 65 : 45);
  markets.push({ market: 'Ambas Marcam', probability: bttsProb, risk: 'Médio', category: 'goals' });

  // Over 0.5 HT (Gol no 1° Tempo)
  const htProb = Math.min(90, Math.max(40, expectedGoals * 25));
  markets.push({ market: 'Over 0.5 HT', probability: Math.floor(htProb), risk: 'Baixo', category: 'goals' });

  // --- ESCANTEIOS ---
  const hCornersAvg = modelData?.homeCornersAvg || (match.metrics?.corners?.[0] || 4);
  const aCornersAvg = modelData?.awayCornersAvg || (match.metrics?.corners?.[1] || 4);
  const cornerExpectancy = isLive 
    ? (lH.corners + lA.corners) + ((lH.dangerousAttacks + lA.dangerousAttacks) * 0.1)
    : hCornersAvg + aCornersAvg;

  markets.push({ 
    market: 'Over 7.5 Cantos', 
    probability: Math.min(92, Math.floor(40 + (cornerExpectancy * 4))), 
    risk: 'Baixo', 
    category: 'corners' 
  });

  // --- CHANCE DUPLA ---
  let dcProb = 50;
  if (isLive) {
    dcProb = lH.dangerousAttacks > lA.dangerousAttacks ? 70 : 65;
  } else {
    dcProb = hGoalsAvg > aGoalsAvg ? 75 : 60;
  }
  markets.push({ market: '1X ou 2X', probability: dcProb, risk: 'Baixo', category: 'result' });

  return markets;
}

export function getBestMarketForProfile(markets: MarketAnalysis[], profile: 'conservador' | 'moderado' | 'agressivo') {
  const thresholds = { conservador: 75, moderado: 65, agressivo: 55 };
  const minProb = thresholds[profile];

  const filtered = markets.filter(m => m.probability >= minProb);
  return filtered.sort((a, b) => b.probability - a.probability)[0] || null;
}
