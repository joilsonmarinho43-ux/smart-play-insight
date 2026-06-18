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

export interface BingoResult {
  over15: number;
  over25: number;
  btts: number;
  markets: MarketAnalysis[];
  allMarkets: MarketAnalysis[];
  avgConfidence: number;
  confidenceMode?: 'normal' | 'conservative' | 'info_only' | 'discard';
  confidenceScore?: number;
}

/** Tipo exportado para componentes */
export interface BingoMatchData extends MatchData {
  selectedMarkets: MarketAnalysis[];
  avgConfidence: number;
  confidenceMode?: 'normal' | 'conservative' | 'info_only' | 'discard';
  confidenceScore?: number;
}

export function generatePreGameBingo(match: MatchData, confidenceScore?: number): BingoResult | null {
  if (!isStableLeague(match)) return null;
  if (!hasReliableData(match)) return null;

  // ─── CONFIDENCE POLICY ────────────────────────────────────────
  // ≥85 normal | 70-84 conservador (limiar 80%) | 50-69 info_only | <50 discard
  let mode: 'normal' | 'conservative' | 'info_only' | 'discard' = 'normal';
  if (typeof confidenceScore === 'number') {
    if (confidenceScore < 50) mode = 'discard';
    else if (confidenceScore < 70) mode = 'info_only';
    else if (confidenceScore < 85) mode = 'conservative';
  }
  if (mode === 'discard' || mode === 'info_only') {
    // eslint-disable-next-line no-console
    console.log(`[BINGO][CONFIDENCE] ${mode === 'discard' ? '🔴' : '🔵'} ${match.homeTeam} vs ${match.awayTeam} score=${confidenceScore} → ${mode}`);
    return null;
  }

  const allMarkets = analyzeMarkets(match);
  if (!allMarkets || allMarkets.length === 0) return null;

  // Conservador: limiar mínimo 80% (vs 72% normal) — exige mais confluência
  const minProb = mode === 'conservative' ? 80 : 72;
  const secondMinProb = mode === 'conservative' ? 85 : 78;
  const maxMarkets = mode === 'conservative' ? 4 : 6;

  const highValueMarkets = allMarkets.filter(m => m.probability >= minProb && m.probability <= 98);
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
      if (catMarkets.length > 1 && catMarkets[1].probability >= secondMinProb) {
        bestByCategory.push(catMarkets[1]);
      }
    }
  }

  const selected = bestByCategory
    .sort((a, b) => b.probability - a.probability)
    .slice(0, maxMarkets);

  if (selected.length === 0) return null;

  const avgConfidence = selected.reduce((sum, m) => sum + m.probability, 0) / selected.length;

  if (mode === 'conservative') {
    // eslint-disable-next-line no-console
    console.log(`[BINGO][CONFIDENCE] 🟡 ${match.homeTeam} vs ${match.awayTeam} score=${confidenceScore} → conservador (min ${minProb}%, ${selected.length} mercados)`);
  }

  return {
    over15: findProb(allMarkets, 'Over 1.5 Gols'),
    over25: findProb(allMarkets, 'Over 2.5 Gols'),
    btts: findProb(allMarkets, 'Ambas Marcam'),
    markets: selected,
    allMarkets: highValueMarkets,
    avgConfidence,
    confidenceMode: mode,
    confidenceScore,
  };
}


function findProb(markets: MarketAnalysis[], name: string): number {
  const found = markets.find(m => m.market === name);
  return found ? found.probability : 0;
}

export function formatBingoWhatsApp(bingoMatches: BingoMatchData[]): string {
  const header = `🎯 *BINGO VIP — NEXUS 33*\n*Trade Esportivo Profissional*\n${'─'.repeat(30)}\n\n`;

  const body = bingoMatches.map(bm => {
    const matchHeader = `⚽ *${bm.homeTeam} vs ${bm.awayTeam}*\n`;
    const details = `🏆 ${bm.league || 'Liga'} • ⏰ ${bm.time || 'A definir'}\n`;
    const tips = bm.selectedMarkets.map((m) => {
      const prob = m.probability;
      const catMeta = CATEGORY_META[m.category] || { icon: '📌' };
      const emoji = prob >= 90 ? '🟢🔥' : prob >= 85 ? '🟢' : prob >= 78 ? '🟡' : '⚪';
      return `${emoji} ${catMeta.icon} *${m.market}* → _${prob}%_`;
    }).join('\n');
    return `${matchHeader}${details}${tips}\n`;
  }).join('\n');

  const footer = `\n${'─'.repeat(30)}\n📊 *${bingoMatches.length} jogos selecionados*\n🧠 _Poisson + xG Cross-Validation_\n✅ _Confiança mínima: 72% | Matemática Real_`;

  return header + body + footer;
}
