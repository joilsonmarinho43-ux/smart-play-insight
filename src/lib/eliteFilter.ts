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

/** 1. Escanteios: soma das médias ≥ 7 já indica potencial */
function evaluateCorners(match: MatchData): number {
  const hCorners = (match as any).homeStats?.corners || match.modelData?.homeCornersAvg || 0;
  const aCorners = (match as any).awayStats?.corners || match.modelData?.awayCornersAvg || 0;
  const total = hCorners + aCorners;

  if (total <= 0) return 0;
  if (total >= 10) return Math.min(100, 60 + (total - 10) * 8);
  if (total >= 8) return Math.min(85, 45 + (total - 8) * 10);
  if (total >= 6) return Math.min(60, 25 + (total - 6) * 10);
  return Math.max(0, (total / 6) * 20);
}

/** 2. Gols: baseado em Lambda Poisson + dados de finalizações */
function evaluateGoals(match: MatchData, markets: MarketAnalysis[]): number {
  const md = (match as any).modelData || {};
  const hs = (match as any).homeStats || {};
  const as_ = (match as any).awayStats || {};

  const hGF = md.homeGoalsAvg || hs.goalsFor || 0;
  const aGF = md.awayGoalsAvg || as_.goalsFor || 0;
  const totalGoalsAvg = hGF + aGF;

  // Finalizações como indicador de potencial ofensivo
  const totalShots = (hs.totalShots || 0) + (as_.totalShots || 0);
  const totalSoG = (hs.shotsOnGoal || 0) + (as_.shotsOnGoal || 0);

  // Score base via média de gols
  let score = 0;
  if (totalGoalsAvg >= 3.5) score += 55;
  else if (totalGoalsAvg >= 2.5) score += 40;
  else if (totalGoalsAvg >= 2.0) score += 25;

  // Bonus por finalizações (indica jogos ofensivos)
  if (totalShots >= 25) score += 25;
  else if (totalShots >= 15) score += 15;
  if (totalSoG >= 10) score += 20;
  else if (totalSoG >= 5) score += 10;

  // Sem finalizações disponíveis (pré-jogo), refina o score pela média real de gols
  if (totalShots === 0 && totalSoG === 0) {
    score += Math.min(30, Math.max(0, totalGoalsAvg - 2.0) * 20);
  }

  return Math.min(100, score);
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
  if (apm >= 0.8) score += 55;
  else if (apm >= 0.5) score += 35;
  else score += (apm / 0.5) * 25;

  score += sogRatio * 45;
  return Math.min(100, score);
}

/** Dados suficientes? */
function hasEnoughData(match: MatchData): boolean {
  const hGames = match.sampleSize?.homeGames || (match as any).homeStats?.gamesCount || 0;
  const aGames = match.sampleSize?.awayGames || (match as any).awayStats?.gamesCount || 0;
  return hGames >= 3 && aGames >= 3;
}

function hasGoalsData(match: MatchData): boolean {
  const md = (match as any).modelData || {};
  const hs = (match as any).homeStats || {};
  const as_ = (match as any).awayStats || {};
  return (md.homeGoalsAvg || hs.goalsFor || 0) > 0 && (md.awayGoalsAvg || as_.goalsFor || 0) > 0;
}

function hasIntensityData(match: MatchData): boolean {
  const hs = (match as any).homeStats || {};
  const as_ = (match as any).awayStats || {};
  return ((hs.totalShots || 0) + (as_.totalShots || 0) + (hs.shotsOnGoal || 0) +
    (as_.shotsOnGoal || 0) + (hs.dangerousAttacks || 0) + (as_.dangerousAttacks || 0)) > 0;
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
      if (cornersScore >= 40) tags.push('corners');
      if (goalsScore >= 40) tags.push('goals');
      if (cardsScore >= 50) tags.push('cards');
      if (intensityScore >= 50) tags.push('intense');

      // Pré-jogo raramente traz escanteios/cartões/finalizações. Em vez de zerar
      // o score (o que esvaziava o painel), o peso é renormalizado apenas sobre
      // as dimensões que realmente têm dado — sem inventar números.
      const dims: { score: number; weight: number; available: boolean }[] = [
        { score: goalsScore, weight: 0.35, available: hasGoalsData(match) },
        { score: cornersScore, weight: 0.25, available: cornersScore > 0 },
        { score: cardsScore, weight: 0.2, available: cardsScore > 0 },
        { score: intensityScore, weight: 0.2, available: hasIntensityData(match) },
      ].filter(d => d.available);

      const totalWeight = dims.reduce((s2, d) => s2 + d.weight, 0);
      const eliteScore = totalWeight > 0
        ? Math.round(dims.reduce((s2, d) => s2 + d.score * d.weight, 0) / totalWeight)
        : 0;

      return { match, tags, cornersScore, goalsScore, cardsScore, intensityScore, eliteScore };
    })
    .filter(e => e.tags.length >= 1 && e.eliteScore >= 50) // Threshold elevado de 45→50
    .sort((a, b) => b.eliteScore - a.eliteScore);
}
