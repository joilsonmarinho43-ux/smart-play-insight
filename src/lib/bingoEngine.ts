import { MatchData, MarketAnalysis } from '@/types/match';
import { analyzeMarkets } from './matchAnalysis';

/**
 * 🔥 GERADOR DE BINGO REAL (PROFISSIONAL)
 * Transforma a análise individual em uma estrutura de bilhete de valor.
 */
export function generatePreGameBingo(match: MatchData) {
  // 1. Obtém todos os mercados analisados com a nova matemática (Poisson/Médias)
  const allMarkets = analyzeMarkets(match);
  
  if (!allMarkets || allMarkets.length === 0) return null;

  // 2. Filtro de Qualidade: Remove mercados com probabilidade irrelevante para Trade
  const highValueMarkets = allMarkets.filter((m) => {
    // No Trade Real, buscamos confiança acima de 60% e descartamos o que é "chute"
    return m.probability >= 60 && m.probability <= 98;
  });

  if (highValueMarkets.length === 0) return null;

  // 3. Ordem de Prioridade para o Bilhete (Mercados com maior liquidez e segurança)
  const priorityOrder = [
    'Over 1.5 Gols',
    'Ambas Marcam',
    'Over 7.5 Cantos',
    '1X ou 2X',
    'Over 0.5 HT',
    'Over 2.5 Gols',
  ];

  // 4. Ordenação por Probabilidade + Prioridade de Mercado
  const sorted = highValueMarkets.sort((a, b) => {
    const priorityA = priorityOrder.indexOf(a.market);
    const priorityB = priorityOrder.indexOf(b.market);
    
    // Se ambos estão na lista de prioridade, decide pela probabilidade
    if (priorityA !== -1 && priorityB !== -1) {
      return b.probability - a.probability;
    }
    // Caso contrário, joga os priorizados para cima
    return (priorityA === -1 ? 99 : priorityA) - (priorityB === -1 ? 99 : priorityB);
  });

  // 5. Seleciona os 3 mercados "Elite" para este jogo
  const selected = sorted.slice(0, 3);

  // 6. Mapeia para o objeto de retorno esperado pelo componente BingoSuggestion
  return {
    // Valores diretos para compatibilidade com o front
    over15: findProb(allMarkets, 'Over 1.5 Gols'),
    over25: findProb(allMarkets, 'Over 2.5 Gols'),
    btts: findProb(allMarkets, 'Ambas Marcam'),
    markets: selected, // Lista completa para o Map do Frontend
  };
}

/**
 * Auxiliar para encontrar a probabilidade exata calculada no matchAnalysis
 */
function findProb(markets: MarketAnalysis[], name: string): number {
  const found = markets.find(m => m.market === name);
  return found ? found.probability : 0;
}

/**
 * Gera multi-bilhetes inteligentes a partir de uma lista de jogos
 */
export function generateSmartBets(matches: any[]) {
  const allPicks: any[] = [];

  for (const match of matches) {
    const result = generatePreGameBingo(match);
    if (!result || !result.markets.length) continue;

    const best = result.markets[0];
    allPicks.push({
      match,
      market: best.market,
      probability: best.probability,
    });
  }

  if (allPicks.length < 2) return [];

  const sorted = allPicks.sort((a, b) => b.probability - a.probability);

  const tickets: any[] = [];

  // Bilhete 1: top 3
  const t1 = sorted.slice(0, 3);
  if (t1.length >= 2) {
    const prob = t1.reduce((acc, p) => acc * (p.probability / 100), 1) * 100;
    tickets.push({ picks: t1, probability: parseFloat(prob.toFixed(1)) });
  }

  // Bilhete 2: next 3
  const t2 = sorted.slice(3, 6);
  if (t2.length >= 2) {
    const prob = t2.reduce((acc, p) => acc * (p.probability / 100), 1) * 100;
    tickets.push({ picks: t2, probability: parseFloat(prob.toFixed(1)) });
  }

  return tickets;
}
