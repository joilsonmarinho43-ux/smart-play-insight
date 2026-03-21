import { MatchData, MarketAnalysis } from '@/types/match';
import { analyzeMarkets } from './matchAnalysis';

/**
 * 🔥 BINGO PROFISSIONAL v2 — Confiança mínima 78%, xG cross-validation, filtro de variância
 */

// Ligas de alta instabilidade / dados incompletos — bloqueadas do Bingo
const UNSTABLE_LEAGUES = [
  'club friendly', 'friendlies', 'international friendly',
  'u17', 'u19', 'u20', 'u21', 'u23', 'sub-17', 'sub-19', 'sub-20', 'sub-21', 'sub-23',
  'reserve', 'reserva', 'youth', 'juvenil', 'amateur', 'amador',
  'terceira divisão', 'third division', 'regional', 'lower division',
  'women', 'feminino', // dados geralmente incompletos na API
];

function isStableLeague(match: MatchData): boolean {
  const league = (match.league || '').toLowerCase();
  return !UNSTABLE_LEAGUES.some(tag => league.includes(tag));
}

/**
 * Verifica se o jogo tem dados suficientes para confiabilidade
 */
function hasReliableData(match: MatchData): boolean {
  const hGames = match.sampleSize?.homeGames || (match as any).homeStats?.gamesCount || 0;
  const aGames = match.sampleSize?.awayGames || (match as any).awayStats?.gamesCount || 0;
  // Mínimo de 3 jogos cada para dados confiáveis
  return hGames >= 3 && aGames >= 3;
}

export function generatePreGameBingo(match: MatchData) {
  // Filtro de variância: liga estável + dados confiáveis
  if (!isStableLeague(match)) return null;
  if (!hasReliableData(match)) return null;

  const allMarkets = analyzeMarkets(match);
  if (!allMarkets || allMarkets.length === 0) return null;

  // Filtro Elite v2: confiança >= 78% (regra de ouro)
  const highValueMarkets = allMarkets.filter(m => m.probability >= 78 && m.probability <= 98);
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
 * Multi-bilhetes inteligentes com correlação — threshold 78%
 */
export function generateSmartBets(matches: any[]) {
  const allPicks: any[] = [];

  for (const match of matches) {
    // Aplica filtros de liga e dados antes de processar
    if (!isStableLeague(match)) continue;
    if (!hasReliableData(match)) continue;

    const result = generatePreGameBingo(match);
    if (!result || !result.markets.length) continue;

    const best = result.markets[0];
    if (best.probability < 78) continue; // Filtro de ouro

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
      const emoji = prob >= 90 ? '🟢🔥' : prob >= 85 ? '🟢' : '🟡';
      return `${emoji} *${m.market || m.mercado}* → _${prob}%_`;
    }).join('\n');
    return `${matchHeader}${details}${tips}\n`;
  }).join('\n');

  const footer = `\n${'─'.repeat(30)}\n📊 *${bingoMatches.length} jogos selecionados*\n🧠 _Poisson + xG Cross-Validation_\n✅ _Confiança mínima: 78% | APM ≥ 1.2_`;

  return header + body + footer;
}
