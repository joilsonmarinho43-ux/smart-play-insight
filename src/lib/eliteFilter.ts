import { MatchData, MarketAnalysis } from '@/types/match';
import { analyzeMarkets } from '@/lib/matchAnalysis';
import { isBookmakerLeague } from '@/lib/bookmakerLeagues';
import { isUpcomingMatch } from '@/lib/matchTiming';

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
function numericOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getCombinedAPM(match: MatchData): number | null {
  const hDA = (match as any).homeStats?.dangerousAttacks;
  const aDA = (match as any).awayStats?.dangerousAttacks;
  const hShots = (match as any).homeStats?.totalShots;
  const aShots = (match as any).awayStats?.totalShots;
  const hSoG = (match as any).homeStats?.shotsOnGoal;
  const aSoG = (match as any).awayStats?.shotsOnGoal;

  if ([hDA, aDA, hShots, aShots, hSoG, aSoG].every(v => numericOrNull(v) !== null)) {
    if ((hDA! > 0) || (aDA! > 0)) return (hDA! + aDA!) / 90;
    return ((hShots! + aShots!) * 1.5 + (hSoG! + aSoG!) * 2) / 90;
  }
  return null;
}

// ─── Critérios de filtragem ───

/** 1. Escanteios: soma das médias ≥ 7 já indica potencial */
function evaluateCorners(match: MatchData): number {
  const hCorners = (match as any).homeStats?.corners ?? match.modelData?.homeCornersAvg;
  const aCorners = (match as any).awayStats?.corners ?? match.modelData?.awayCornersAvg;
  const hc = numericOrNull(hCorners), ac = numericOrNull(aCorners);
  if (hc === null || ac === null) return 0;
  const total = hc + ac;

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

  const hGF = md.homeGoalsAvg ?? hs.goalsFor;
  const aGF = md.awayGoalsAvg ?? as_.goalsFor;
  const hg = numericOrNull(hGF), ag = numericOrNull(aGF);
  if (hg === null || ag === null) return 0;
  const totalGoalsAvg = hg + ag;

  // Finalizações como indicador de potencial ofensivo
  const ts = numericOrNull(hs.totalShots), asTs = numericOrNull(as_.totalShots);
  const hsog = numericOrNull(hs.shotsOnGoal), asog = numericOrNull(as_.shotsOnGoal);
  const totalShots = ts !== null && asTs !== null ? ts + asTs : 0;
  const totalSoG = hsog !== null && asog !== null ? hsog + asog : 0;

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
  const hCards = (match as any).homeStats?.yellowCards ?? match.modelData?.homeCardsAvg;
  const aCards = (match as any).awayStats?.yellowCards ?? match.modelData?.awayCardsAvg;
  const hFouls = (match as any).homeStats?.fouls;
  const aFouls = (match as any).awayStats?.fouls;

  const hc = numericOrNull(hCards), ac = numericOrNull(aCards), hf = numericOrNull(hFouls), af = numericOrNull(aFouls);
  if (hc === null || ac === null || hf === null || af === null) return 0;
  const totalCards = hc + ac;
  const totalFouls = hf + af;

  const cardScore = Math.min(60, totalCards * 12);
  const foulBonus = Math.min(40, totalFouls * 1.2);
  return Math.min(100, cardScore + foulBonus);
}

/** 4. Intensidade: APM ≥ 1.2 como threshold principal */
function evaluateIntensity(match: MatchData): number {
  const hShots = (match as any).homeStats?.totalShots;
  const aShots = (match as any).awayStats?.totalShots;
  const hSoG = (match as any).homeStats?.shotsOnGoal;
  const aSoG = (match as any).awayStats?.shotsOnGoal;

  const hs = numericOrNull(hShots), as = numericOrNull(aShots), hsog = numericOrNull(hSoG), asog = numericOrNull(aSoG), apm = getCombinedAPM(match);
  if (hs === null || as === null || hsog === null || asog === null || apm === null) return 0;
  const totalShots = hs + as;
  const totalSoG = hsog + asog;
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
  const hGames = match.sampleSize?.homeGames || (match as any).homeStats?.gamesCount;
  const aGames = match.sampleSize?.awayGames || (match as any).awayStats?.gamesCount;
  return typeof hGames === 'number' && typeof aGames === 'number' && hGames >= 4 && aGames >= 4;
}

function hasGoalsData(match: MatchData): boolean {
  const md = (match as any).modelData || {};
  const hs = (match as any).homeStats || {};
  const as_ = (match as any).awayStats || {};
  return numericOrNull(md.homeGoalsAvg ?? hs.goalsFor) !== null && numericOrNull(md.awayGoalsAvg ?? as_.goalsFor) !== null;
}

function hasIntensityData(match: MatchData): boolean {
  const hs = (match as any).homeStats || {};
  const as_ = (match as any).awayStats || {};
  return [hs.totalShots, as_.totalShots, hs.shotsOnGoal, as_.shotsOnGoal, hs.dangerousAttacks, as_.dangerousAttacks].some(v => numericOrNull(v) !== null && numericOrNull(v)! > 0);
}

// ─── Engine principal ───

/** Menor amostra entre as duas equipes */
function minSample(match: MatchData): number {
  const h = match.sampleSize?.homeGames || (match as any).homeStats?.gamesCount;
  const a = match.sampleSize?.awayGames || (match as any).awayStats?.gamesCount;
  return typeof h === 'number' && typeof a === 'number' ? Math.min(h, a) : 0;
}

/** Máximo de jogos exibidos no painel Elite */
const MAX_ELITE = 12;

export function filterEliteMatches(matches: MatchData[]): EliteMatch[] {
  return matches
    .filter(m => !m.isLive)
    .filter(isHighQualityLeague)
    // Só jogos que o usuário realmente encontra nas casas de aposta
    .filter(m => isBookmakerLeague(m.league || ''))
    // Só jogos que ainda não começaram (nada de partidas já encerradas)
    .filter(m => isUpcomingMatch(m))
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
      const raw = totalWeight > 0
        ? dims.reduce((s2, d) => s2 + d.score * d.weight, 0) / totalWeight
        : 0;

      // Penalização de confiança: poucas dimensões com dado real ou amostra curta
      // não podem competir com jogos totalmente cobertos.
      const sample = minSample(match);
      const coverage = Math.min(1, totalWeight / 0.6);   // 0.6 = gols + cantos
      const samplePenalty = sample >= 6 ? 1 : sample >= 5 ? 0.96 : sample >= 4 ? 0.92 : 0.85;
      const eliteScore = Math.round(raw * (0.8 + 0.2 * coverage) * samplePenalty);

      return { match, tags, cornersScore, goalsScore, cardsScore, intensityScore, eliteScore };
    })
    .filter(e => e.tags.length >= 1 && e.eliteScore >= 55)
    .sort((a, b) => b.eliteScore - a.eliteScore)
    .slice(0, MAX_ELITE);
}
