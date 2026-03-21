import { MatchData, MarketAnalysis } from '@/types/match';
import { analyzeMarkets } from '@/lib/matchAnalysis';

/**
 * Elite Performance Filter v2 — APM ≥ 1.2, weighted stats, variance filter
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

// Ligas bloqueadas — dados instáveis ou incompletos
const LOW_QUALITY_LEAGUES = [
  'Club Friendly', 'Friendlies', 'International Friendly',
  'U17', 'U19', 'U20', 'U21', 'U23', 'Sub-17', 'Sub-19', 'Sub-20', 'Sub-21',
  'Reserve', 'Youth', 'Amateur', 'Regional',
];

function isHighQualityLeague(match: MatchData): boolean {
  const league = match.league || '';
  return !LOW_QUALITY_LEAGUES.some(l => league.toLowerCase().includes(l.toLowerCase()));
}

/** Calcula APM combinado */
function getCombinedAPM(match: MatchData): number {
  const hDA = (match as any).homeStats?.dangerousAttacks || 0;
  const aDA = (match as any).awayStats?.dangerousAttacks || 0;
  const hShots = (match as any).homeStats?.totalShots || 0;
  const aShots = (match as any).awayStats?.totalShots || 0;
  const hSoG = (match as any).homeStats?.shotsOnGoal || 0;
  const aSoG = (match as any).awayStats?.shotsOnGoal || 0;

  if (hDA > 0 || aDA > 0) return (hDA + aDA) / 90;
  return ((hShots + aShots) * 1.5 + (hSoG + aSoG) * 2) / 90;
}

// ─── Critérios de filtragem ───

/** 1. Escanteios: soma das médias ≥ 9.5 + APM gate */
function evaluateCorners(match: MatchData): number {
  const hCorners = (match as any).homeStats?.corners || match.modelData?.homeCornersAvg || 0;
  const aCorners = (match as any).awayStats?.corners || match.modelData?.awayCornersAvg || 0;
  const total = hCorners + aCorners;
  const apm = getCombinedAPM(match);

  // APM gate: precisa de intensidade mínima
  if (apm < 0.8) return Math.max(0, (total / 9.5) * 30); // Score reduzido sem APM

  if (total >= 9.5) return Math.min(100, 50 + (total - 9.5) * 10);
  return Math.max(0, (total / 9.5) * 45);
}

/** 2. Gols: Over 1.5 e Over 2.5 com probabilidade > 78% + APM gate */
function evaluateGoals(match: MatchData, markets: MarketAnalysis[]): number {
  const o15 = markets.find(m => m.market === 'Over 1.5 Gols');
  const o25 = markets.find(m => m.market === 'Over 2.5 Gols');
  const p15 = o15?.probability || 0;
  const p25 = o25?.probability || 0;
  const apm = getCombinedAPM(match);

  // APM gate
  if (apm < 0.8) return Math.max(0, (p15 + p25) / 4);

  if (p15 >= 78 && p25 >= 78) return Math.min(100, (p15 + p25) / 2);
  if (p15 >= 78) return Math.min(85, p15 * 0.8);
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

  const cardScore = Math.min(60, totalCards * 12);
  const foulBonus = Math.min(40, totalFouls * 1.2);
  return Math.min(100, cardScore + foulBonus);
}

/** 4. Intensidade: APM ≥ 1.2 como threshold principal */
function evaluateIntensity(match: MatchData): number {
  const hShots = (match as any).homeStats?.totalShots || 0;
  const aShots = (match as any).awayStats?.totalShots || 0;
  const hSoG = (match as any).homeStats?.shotsOnGoal || 0;
  const aSoG = (match as any).awayStats?.shotsOnGoal || 0;

  const totalShots = hShots + aShots;
  const totalSoG = hSoG + aSoG;
  const apm = getCombinedAPM(match);
  const sogRatio = totalSoG > 0 ? totalSoG / Math.max(1, totalShots) : 0;

  let score = 0;
  if (apm >= 1.2) score += 55;
  else if (apm >= 0.9) score += 35;
  else score += (apm / 0.9) * 25;

  score += sogRatio * 45;
  return Math.min(100, score);
}

/** Dados suficientes? */
function hasEnoughData(match: MatchData): boolean {
  const hGames = match.sampleSize?.homeGames || (match as any).homeStats?.gamesCount || 0;
  const aGames = match.sampleSize?.awayGames || (match as any).awayStats?.gamesCount || 0;
  return hGames >= 3 && aGames >= 3;
}

// ─── Engine principal ───

export function filterEliteMatches(matches: MatchData[]): EliteMatch[] {
  return matches
    .filter(m => !m.isLive)
    .filter(isHighQualityLeague)
    .filter(hasEnoughData)
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
    .filter(e => e.tags.length >= 1 && e.eliteScore >= 50) // Threshold elevado de 45→50
    .sort((a, b) => b.eliteScore - a.eliteScore);
}
