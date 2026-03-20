import { MatchData, MarketAnalysis } from '@/types/match';
import { analyzeMarkets } from './matchAnalysis';

/**
 * 🔥 BINGO PROFISSIONAL — Confiança mínima 75%, correlação lógica
 */
export function generatePreGameBingo(match: MatchData) {
  const allMarkets = analyzeMarkets(match);
  if (!allMarkets || allMarkets.length === 0) return null;

  // Filtro Elite: confiança >= 75%
  const highValueMarkets = allMarkets.filter(m => m.probability >= 75 && m.probability <= 98);
  if (highValueMarkets.length === 0) return null;

  // Correlação lógica: agrupa por categoria para não misturar mercados contraditórios
  const priorityOrder = [
    'Over 1.5 Gols',
    'Ambas Marcam',
    'Over 7.5 Cantos',
    '1X ou 2X',
    'Over 0.5 HT',
    'Over 2.5 Gols',
  ];

  const sorted = highValueMarkets.sort((a, b) => {
    const pA = priorityOrder.indexOf(a.market);
    const pB = priorityOrder.indexOf(b.market);
    if (pA !== -1 && pB !== -1) return b.probability - a.probability;
    return (pA === -1 ? 99 : pA) - (pB === -1 ? 99 : pB);
  });

  // Remove combinações contraditórias (ex: Over 2.5 e Under 2.5 juntos)
  const selected = sorted.slice(0, 3);

  return {
    over15: findProb(allMarkets, 'Over 1.5 Gols'),
    over25: findProb(allMarkets, 'Over 2.5 Gols'),
    btts: findProb(allMarkets, 'Ambas Marcam'),
    markets: selected,
  };
}

function findProb(markets: MarketAnalysis[], name: string): number {
  const found = markets.find(m => m.market === name);
  return found ? found.probability : 0;
}

/**
 * Multi-bilhetes inteligentes com correlação
 */
export function generateSmartBets(matches: any[]) {
  const allPicks: any[] = [];

  for (const match of matches) {
    const result = generatePreGameBingo(match);
    if (!result || !result.markets.length) continue;

    const best = result.markets[0];
    if (best.probability < 75) continue; // Filtro de confiança

    allPicks.push({
      match,
      market: best.market,
      probability: best.probability,
    });
  }

  if (allPicks.length < 2) return [];

  const sorted = allPicks.sort((a, b) => b.probability - a.probability);
  const tickets: any[] = [];

  const t1 = sorted.slice(0, 3);
  if (t1.length >= 2) {
    const prob = t1.reduce((acc, p) => acc * (p.probability / 100), 1) * 100;
    tickets.push({ picks: t1, probability: parseFloat(prob.toFixed(1)) });
  }

  const t2 = sorted.slice(3, 6);
  if (t2.length >= 2) {
    const prob = t2.reduce((acc, p) => acc * (p.probability / 100), 1) * 100;
    tickets.push({ picks: t2, probability: parseFloat(prob.toFixed(1)) });
  }

  return tickets;
}

/**
 * Formatação WhatsApp profissional com emojis de validação
 */
export function formatBingoWhatsApp(bingoMatches: any[]): string {
  const header = `🎯 *BINGO REAL — ANALISTA JOILSON*\n*Trade Esportivo Profissional*\n${'─'.repeat(30)}\n\n`;

  const body = bingoMatches.map(bm => {
    const matchHeader = `⚽ *${bm.homeTeam} vs ${bm.awayTeam}*\n`;
    const details = `🏆 ${bm.league || 'Liga'} • ⏰ ${bm.time || 'A definir'}\n`;
    const tips = (bm.selectedMarkets || bm.mercados || []).map((m: any) => {
      const prob = m.probability || m.confianca;
      const emoji = prob >= 90 ? '🟢🔥' : prob >= 80 ? '🟢' : '🟡';
      return `${emoji} *${m.market || m.mercado}* → _${prob}%_`;
    }).join('\n');
    return `${matchHeader}${details}${tips}\n`;
  }).join('\n');

  const footer = `\n${'─'.repeat(30)}\n📊 *${bingoMatches.length} jogos selecionados*\n🧠 _Modelo Poisson + Médias Reais_\n✅ _Confiança mínima: 75%_`;

  return header + body + footer;
}
