import { MatchData, MarketAnalysis } from '@/types/match';
import { analyzeMarkets } from '@/lib/matchAnalysis';

/**
 * Elite Performance Filter — seleciona apenas jogos de alta probabilidade
 * para os mercados de Escanteios, Gols e Cartões.
 */

export interface EliteMatch {
  match: MatchData;
  tags: EliteTag[];
  cornersScore: number;
  goalsScore: number;
  cardsScore: number;
  intensityScore: number;
  eliteScore: number;
}

export type EliteTag = 'corners' | 'goals' | 'cards' | 'intense';

const TAG_LABELS: Record<EliteTag, string> = {
  corners: '⛳ Escanteios',
  goals: '⚽ Gols',
  cards: '🟨 Cartões',
  intense: '🔥 Intenso',
};

const TAG_COLORS: Record<EliteTag, string> = {
  corners: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  goals: 'bg-green-500/20 text-green-400 border-green-500/30',
  cards: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  intense: 'bg-red-500/20 text-red-400 border-red-500/30',
};

export { TAG_LABELS, TAG_COLORS };

// ─── Critérios de filtragem ───

/** 1. Escanteios: soma das médias ≥ 9.5 */
function evaluateCorners(match: MatchData): number {
  const hCorners = (match as any).homeStats?.corners || match.modelData?.homeCornersAvg || 0;
  const aCorners = (match as any).awayStats?.corners || match.modelData?.awayCornersAvg || 0;
  const total = hCorners + aCorners;
  // Score 0-100 baseado na distância do threshold 9.5
  if (total >= 9.5) return Math.min(100, 50 + (total - 9.5) * 10);
  return Math.max(0, (total / 9.5) * 45);
}

/** 2. Gols: Over 1.5 e Over 2.5 com probabilidade > 75% (Poisson) */
function evaluateGoals(match: MatchData, markets: MarketAnalysis[]): number {
  const o15 = markets.find(m => m.market === 'Over 1.5 Gols');
  const o25 = markets.find(m => m.market === 'Over 2.5 Gols');
  const p15 = o15?.probability || 0;
  const p25 = o25?.probability || 0;

  if (p15 >= 75 && p25 >= 75) return Math.min(100, (p15 + p25) / 2);
  if (p15 >= 75) return Math.min(85, p15 * 0.8);
  return Math.max(0, (p15 + p25) / 3);
}

/** 3. Cartões: times com alta média de cartões + faltas */
function evaluateCards(match: MatchData): number {
  const hCards = (match as any).homeStats?.yellowCards || match.modelData?.homeCardsAvg || 0;
  const aCards = (match as any).awayStats?.yellowCards || match.modelData?.awayCardsAvg || 0;
  const hFouls = (match as any).homeStats?.fouls || 0;
  const aFouls = (match as any).awayStats?.fouls || 0;

  const totalCards = hCards + aCards;
  const totalFouls = hFouls + aFouls;

  // Alta agressividade: soma de cartões ≥ 4 e faltas altas
  const cardScore = Math.min(60, totalCards * 12);
  const foulBonus = Math.min(40, totalFouls * 1.2);
  return Math.min(100, cardScore + foulBonus);
}

/** 4. Intensidade: alto índice de finalizações e ataques perigosos */
function evaluateIntensity(match: MatchData): number {
  const hShots = (match as any).homeStats?.totalShots || 0;
  const aShots = (match as any).awayStats?.totalShots || 0;
  const hSoG = (match as any).homeStats?.shotsOnGoal || 0;
  const aSoG = (match as any).awayStats?.shotsOnGoal || 0;

  const totalShots = hShots + aShots;
  const totalSoG = hSoG + aSoG;

  // APM estimado (ataques perigosos por minuto simulado via finalizações)
  const apmEstimate = totalShots / 90;
  const sogRatio = totalSoG > 0 ? totalSoG / Math.max(1, totalShots) : 0;

  let score = 0;
  if (apmEstimate >= 0.7) score += 50;
  else score += (apmEstimate / 0.7) * 40;

  score += sogRatio * 50;
  return Math.min(100, score);
}

/** Filtro de antecedência: pelo menos 2h antes do início */
function isAtLeast2HoursAway(match: MatchData): boolean {
  const timeStr = (match as any).fixture?.date;
  if (!timeStr) return true; // Se não tem data, inclui por padrão
  const matchTime = new Date(timeStr).getTime();
  const now = Date.now();
  return matchTime - now >= 2 * 60 * 60 * 1000;
}

/** Ligas de baixa confiabilidade — remover */
const LOW_QUALITY_LEAGUES = [
  'Club Friendly',
  'Friendlies',
  'International Friendly',
];

function isHighQualityLeague(match: MatchData): boolean {
  const league = match.league || '';
  return !LOW_QUALITY_LEAGUES.some(l => league.toLowerCase().includes(l.toLowerCase()));
}

// ─── Engine principal ───

export function filterEliteMatches(matches: MatchData[]): EliteMatch[] {
  return matches
    .filter(m => !m.isLive)
    .filter(isHighQualityLeague)
    .map(match => {
      const markets = analyzeMarkets(match);
      const cornersScore = evaluateCorners(match);
      const goalsScore = evaluateGoals(match, markets);
      const cardsScore = evaluateCards(match);
      const intensityScore = evaluateIntensity(match);

      const tags: EliteTag[] = [];
      if (cornersScore >= 50) tags.push('corners');
      if (goalsScore >= 60) tags.push('goals');
      if (cardsScore >= 50) tags.push('cards');
      if (intensityScore >= 50) tags.push('intense');

      const eliteScore = Math.round(
        cornersScore * 0.25 + goalsScore * 0.35 + cardsScore * 0.2 + intensityScore * 0.2
      );

      return { match, tags, cornersScore, goalsScore, cardsScore, intensityScore, eliteScore };
    })
    .filter(e => e.tags.length >= 1 && e.eliteScore >= 45)
    .sort((a, b) => b.eliteScore - a.eliteScore);
}
