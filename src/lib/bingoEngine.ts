import { MatchData, MarketAnalysis } from '@/types/match';
import { analyzeMarkets } from './matchAnalysis';

/**
 * 🔥 BINGO VIP v3 — 10 estratégias com matemática Poisson + xG
 * Mercados: Gols, Ambas Marcam, Escanteios, Cartões, Handicap, HT/FT, Chance Dupla, Vitória
 */

const UNSTABLE_LEAGUES = [
  'club friendly', 'friendlies', 'international friendly',
  'u17', 'u19', 'u20', 'u21', 'u23', 'sub-17', 'sub-19', 'sub-20', 'sub-21', 'sub-23',
  'reserve', 'reserva', 'youth', 'juvenil', 'amateur', 'amador',
  'terceira divisão', 'third division', 'regional', 'lower division',
  'women', 'feminino',
];

function isStableLeague(match: MatchData): boolean {
  const league = (match.league || '').toLowerCase();
  return !UNSTABLE_LEAGUES.some(tag => league.includes(tag));
}

function hasReliableData(match: MatchData): boolean {
  const hGames = match.sampleSize?.homeGames || (match as any).homeStats?.gamesCount || 0;
  const aGames = match.sampleSize?.awayGames || (match as any).awayStats?.gamesCount || 0;
  return hGames >= 3 && aGames >= 3;
}

/** Ícone e cor por categoria */
export const CATEGORY_META: Record<string, { icon: string; label: string; color: string }> = {
  goals: { icon: '⚽', label: 'Gols', color: 'orange' },
  btts: { icon: '🤝', label: 'Ambas Marcam', color: 'green' },
  corners: { icon: '🚩', label: 'Escanteios', color: 'blue' },
  cards: { icon: '🟨', label: 'Cartões', color: 'yellow' },
  result: { icon: '🏆', label: 'Resultado', color: 'purple' },
  chance_dupla: { icon: '🎯', label: 'Chance Dupla', color: 'cyan' },
  handicap: { icon: '📊', label: 'Handicap', color: 'pink' },
  htft: { icon: '⏱️', label: 'HT/FT', color: 'emerald' },
};

export function generatePreGameBingo(match: MatchData) {
  if (!isStableLeague(match)) return null;
  if (!hasReliableData(match)) return null;

  const allMarkets = analyzeMarkets(match);
  if (!allMarkets || allMarkets.length === 0) return null;

  // Filtro Elite: confiança >= 72% para incluir mais mercados viáveis
  const highValueMarkets = allMarkets.filter(m => m.probability >= 72 && m.probability <= 98);
  if (highValueMarkets.length === 0) return null;

  // Prioridade por categoria — pega o melhor de cada
  const categories = ['goals', 'btts', 'corners', 'cards', 'result', 'chance_dupla', 'handicap', 'htft'];
  const bestByCategory: MarketAnalysis[] = [];

  for (const cat of categories) {
    const catMarkets = highValueMarkets
      .filter(m => m.category === cat)
      .sort((a, b) => b.probability - a.probability);
    if (catMarkets.length > 0) {
      bestByCategory.push(catMarkets[0]);
      // Add second market if high enough confidence
      if (catMarkets.length > 1 && catMarkets[1].probability >= 78) {
        bestByCategory.push(catMarkets[1]);
      }
    }
  }

  // Ordena por probabilidade e limita a 6 melhores
  const selected = bestByCategory
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 6);

  if (selected.length === 0) return null;

  return {
    over15: findProb(allMarkets, 'Over 1.5 Gols'),
    over25: findProb(allMarkets, 'Over 2.5 Gols'),
    btts: findProb(allMarkets, 'Ambas Marcam'),
    markets: selected,
    allMarkets: highValueMarkets,
  };
}

function findProb(markets: MarketAnalysis[], name: string): number {
  const found = markets.find(m => m.market === name);
  return found ? found.probability : 0;
}

export function generateSmartBets(matches: any[]) {
  const allPicks: any[] = [];

  for (const match of matches) {
    if (!isStableLeague(match)) continue;
    if (!hasReliableData(match)) continue;

    const result = generatePreGameBingo(match);
    if (!result || !result.markets.length) continue;

    const best = result.markets[0];
    if (best.probability < 78) continue;

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

export function formatBingoWhatsApp(bingoMatches: any[]): string {
  const header = `🎯 *BINGO VIP — ANALISTA JOILSON*\n*Trade Esportivo Profissional*\n${'─'.repeat(30)}\n\n`;

  const body = bingoMatches.map(bm => {
    const matchHeader = `⚽ *${bm.homeTeam} vs ${bm.awayTeam}*\n`;
    const details = `🏆 ${bm.league || 'Liga'} • ⏰ ${bm.time || 'A definir'}\n`;
    const tips = (bm.selectedMarkets || bm.mercados || []).map((m: any) => {
      const prob = m.probability || m.confianca;
      const catMeta = CATEGORY_META[m.category] || { icon: '📌' };
      const emoji = prob >= 90 ? '🟢🔥' : prob >= 85 ? '🟢' : prob >= 78 ? '🟡' : '⚪';
      return `${emoji} ${catMeta.icon} *${m.market || m.mercado}* → _${prob}%_`;
    }).join('\n');
    return `${matchHeader}${details}${tips}\n`;
  }).join('\n');

  const footer = `\n${'─'.repeat(30)}\n📊 *${bingoMatches.length} jogos selecionados*\n🧠 _Poisson + xG Cross-Validation_\n✅ _Confiança mínima: 72% | Matemática Real_`;

  return header + body + footer;
}
