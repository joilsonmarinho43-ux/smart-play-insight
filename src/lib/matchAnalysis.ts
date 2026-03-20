import { MatchData, MarketAnalysis } from '@/types/match';

// Analisa mercados do jogo e retorna array de mercados com probabilidade e risco
export function analyzeMarkets(match: MatchData): MarketAnalysis[] {
  if (!match.metrics) return [];

  const { totalShots, corners, yellowCards } = match.metrics;

  const markets: MarketAnalysis[] = [];

  // Over 1.5 Gols
  const over15Prob = Math.min(90, 30 + (totalShots[0] + totalShots[1]) * 5);
  markets.push({ market: 'Over 1.5 Gols', probability: over15Prob, risk: over15Prob > 80 ? 'Alto' : 'Baixo', category: 'goals' });

  // Over 2.5 Gols
  const over25Prob = Math.min(85, 20 + (totalShots[0] + totalShots[1]) * 3);
  markets.push({ market: 'Over 2.5 Gols', probability: over25Prob, risk: over25Prob > 75 ? 'Alto' : 'Baixo', category: 'goals' });

  // BTTS / Ambas marcam
  const bttsProb = Math.min(80, 30 + ((totalShots[0] >= 5 ? 1 : 0) + (totalShots[1] >= 5 ? 1 : 0)) * 20);
  markets.push({ market: 'Ambas marcam', probability: bttsProb, risk: bttsProb > 70 ? 'Alto' : 'Baixo', category: 'goals' });

  // Cartões amarelos
  const yellowProb = Math.min(95, 20 + (yellowCards[0] + yellowCards[1]) * 10);
  markets.push({ market: 'Cartão amarelo', probability: yellowProb, risk: yellowProb > 85 ? 'Alto' : 'Baixo', category: 'cards' });

  // Gol no 1º tempo
  const firstHalfProb = Math.min(90, 25 + ((totalShots[0] + totalShots[1]) / 2) * 10);
  markets.push({ market: 'Gol no 1º tempo', probability: firstHalfProb, risk: firstHalfProb > 80 ? 'Alto' : 'Baixo', category: 'goals' });

  // Chance dupla
  const doubleChanceProb = Math.min(95, 30 + Math.max(totalShots[0], totalShots[1]) * 5);
  markets.push({ market: 'Chance dupla', probability: doubleChanceProb, risk: doubleChanceProb > 85 ? 'Alto' : 'Baixo', category: 'result' });

  // Visitante marca gol
  const awayScoresProb = Math.min(90, 20 + totalShots[1] * 8);
  markets.push({ market: 'Visitante marca gol', probability: awayScoresProb, risk: awayScoresProb > 80 ? 'Alto' : 'Baixo', category: 'goals' });

  // Impedimento
  const offsidesProb = Math.min(95, 15 + match.metrics.offsides[0] + match.metrics.offsides[1]);
  markets.push({ market: 'Impedimento', probability: offsidesProb, risk: offsidesProb > 80 ? 'Alto' : 'Baixo', category: 'result' });

  return markets;
}

// Retorna o mercado com melhor probabilidade para o perfil de risco
export function getBestMarketForProfile(markets: MarketAnalysis[], profile: 'conservador' | 'moderado' | 'agressivo') {
  let minProb = 75;
  if (profile === 'moderado') minProb = 65;
  if (profile === 'agressivo') minProb = 55;

  const filtered = markets.filter(m => m.probability >= minProb && m.risk !== 'Alto');
  return filtered.sort((a, b) => b.probability - a.probability)[0] || null;
                }
