import { MatchData, MarketAnalysis } from '@/types/match';

export function analyzeMarkets(match: MatchData): MarketAnalysis[] {
  const markets: MarketAnalysis[] = [];
  
  // Captura de dados reais vindos da Edge Function
  const isLive = match.isLive;
  const hStats = match.homeStats || { goalsFor: 0, goalsAgainst: 0 };
  const aStats = match.awayStats || { goalsFor: 0, goalsAgainst: 0 };
  
  // Stats de Live (se houver)
  const lH = match.stats?.home || { dangerousAttacks: 0, corners: 0, possession: 0, shotsOnGoal: 0 };
  const lA = match.stats?.away || { dangerousAttacks: 0, corners: 0, possession: 0, shotsOnGoal: 0 };

  // --- LÓGICA DE GOLS (BINGO REAL) ---
  // Expectativa de gols baseada em médias reais (Last 8) + Momento Live
  const expectedGoals = isLive 
    ? ((lH.dangerousAttacks + lA.dangerousAttacks) / 20) + ((lH.shotsOnGoal + lA.shotsOnGoal) * 0.2)
    : (hStats.goalsFor + aStats.goalsAgainst + aStats.goalsFor + hStats.goalsAgainst) / 2;

  // Over 1.5 Gols
  const o15Prob = Math.min(94, Math.max(45, (expectedGoals * 35)));
  markets.push({ 
    market: 'Over 1.5 Gols', 
    probability: Math.floor(o15Prob), 
    risk: o15Prob > 85 ? 'Baixo' : 'Médio', 
    category: 'goals' 
  });

  // Over 2.5 Gols (Mais agressivo para o Bingo)
  const o25Prob = Math.min(88, (expectedGoals * 22));
  markets.push({ 
    market: 'Over 2.5 Gols', 
    probability: Math.floor(o25Prob), 
    risk: o25Prob > 70 ? 'Médio' : 'Alto', 
    category: 'goals' 
  });

  // Ambas Marcam (BTTS) - Baseado em regularidade ofensiva
  const bttsProb = isLive 
    ? (lH.shotsOnGoal > 0 && lA.shotsOnGoal > 0 ? 75 : 40)
    : ((hStats.goalsFor > 1 && aStats.goalsFor > 1) ? 68 : 52);
  markets.push({ market: 'Ambas Marcam', probability: bttsProb, risk: 'Médio', category: 'goals' });

  // --- LÓGICA DE ESCANTEIOS ---
  const cornerExpectancy = isLive 
    ? (lH.corners + lA.corners) + ((lH.dangerousAttacks + lA.dangerousAttacks) * 0.1)
    : 8.5 + (hStats.goalsFor * 0.5); // Simplificação pro pré-jogo

  markets.push({ 
    market: 'Over 7.5 Cantos', 
    probability: Math.min(92, 40 + (cornerExpectancy * 4)), 
    risk: 'Baixo', 
    category: 'corners' 
  });

  // --- CHANCE DUPLA ---
  let dcProb = 50;
  if (isLive) {
    dcProb = lH.dangerousAttacks > lA.dangerousAttacks ? 70 : 65;
  } else {
    dcProb = hStats.goalsFor > aStats.goalsFor ? 75 : 60;
  }
  markets.push({ market: '1X ou 2X', probability: dcProb, risk: 'Baixo', category: 'result' });

  return markets;
}

export function getBestMarketForProfile(markets: MarketAnalysis[], profile: 'conservador' | 'moderado' | 'agressivo') {
  const thresholds = { conservador: 80, moderado: 70, agressivo: 60 };
  const minProb = thresholds[profile];

  const filtered = markets.filter(m => m.probability >= minProb);
  return filtered.sort((a, b) => b.probability - a.probability)[0] || null;
    }
