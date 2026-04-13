import { MatchData, MarketAnalysis } from '@/types/match';
import { analyzeMarkets, isValidBet } from '@/lib/matchAnalysis';

export interface ScannerOpportunity {
  matchId: string;
  match: string;
  minute: number | null;
  league: string;
  opportunity: string;
  probability: number;
  ev: number;
  pressure: number;
  score: number;
  signal: string | null;
  isLive: boolean;
}

// ═══════════════════════════════════════
// Pressão com fallback para DA=0
// ═══════════════════════════════════════
function safeDangerousAttacks(stats: { dangerousAttacks?: number; totalShots?: number; corners?: number; shotsOnGoal?: number }): number {
  if (stats.dangerousAttacks && stats.dangerousAttacks > 0) return stats.dangerousAttacks;
  return ((stats.totalShots || stats.shotsOnGoal || 0) * 1.5) + ((stats.corners || 0) * 2);
}

function calculatePressure(homeStats: any, awayStats: any): number {
  const hDA = safeDangerousAttacks(homeStats || {});
  const aDA = safeDangerousAttacks(awayStats || {});
  const hCorners = homeStats?.corners || 0;
  const aCorners = awayStats?.corners || 0;
  const hSoG = homeStats?.shotsOnGoal || 0;
  const aSoG = awayStats?.shotsOnGoal || 0;

  const raw = (hDA + aDA) * 3 + (hCorners + aCorners) * 5 + (hSoG + aSoG) * 10;
  return Math.min(100, Math.max(0, raw / 5)); // normalised 0-100
}

// ═══════════════════════════════════════
// Detector de Gol Iminente
// ═══════════════════════════════════════
function goalSignal(pressure: number, shotsOnGoal: number, minute: number | null | undefined): boolean {
  return pressure > 70 && shotsOnGoal >= 4 && (minute || 0) >= 20;
}

// ═══════════════════════════════════════
// EV estimado (odd implícita com margem 8%)
// ═══════════════════════════════════════
function estimateEV(probability: number): number {
  if (probability <= 0) return -1;
  const probDecimal = probability / 100;
  // Market implied prob is lower than our model (bookmaker margin ~8%)
  const marketImpliedProb = probDecimal * 0.88;
  const marketOdd = 1 / marketImpliedProb;
  // EV = our edge: what we expect to win per unit staked
  return Math.round((probDecimal * marketOdd - 1) * 100) / 100;
}

// ═══════════════════════════════════════
// Opportunity Score = prob*0.5 + ev*0.3 + pressure*0.2
// ═══════════════════════════════════════
function calculateOpportunityScore(probability: number, ev: number, pressure: number): number {
  const normProb = probability / 100;
  const normEV = Math.max(0, Math.min(1, (ev + 0.1) / 0.2)); // EV typically -0.1 to 0.1
  const normPressure = pressure / 100;
  return normProb * 0.5 + normEV * 0.3 + normPressure * 0.2;
}

// ═══════════════════════════════════════
// Scanner Principal
// ═══════════════════════════════════════
export function scanMatches(matches: MatchData[]): ScannerOpportunity[] {
  const opportunities: ScannerOpportunity[] = [];

  for (const match of matches) {
    const markets = analyzeMarkets(match);
    const isLive = !!match.isLive;

    // Live stats
    const lH = (match as any).stats?.home || {};
    const lA = (match as any).stats?.away || {};
    const hStats = (match as any).homeStats || lH;
    const aStats = (match as any).awayStats || lA;

    const pressure = isLive
      ? calculatePressure(lH, lA)
      : calculatePressure(hStats, aStats);

    const totalSoG = (lH.shotsOnGoal || hStats.shotsOnGoal || 0) + (lA.shotsOnGoal || aStats.shotsOnGoal || 0);
    const minute = match.minute || null;
    const hasGoalSignal = isLive && goalSignal(pressure, totalSoG, minute);

    // Filter valid markets — include more market types for coverage
    const targetMarkets = ['Over 0.5 Gols', 'Over 1.5 Gols', 'Over 2.5 Gols', 'Over 3.5 Gols', 'Ambas Marcam', '1X (Casa ou Empate)', 'X2 (Empate ou Fora)', 'Vitória Casa', 'Vitória Fora'];

    for (const market of markets) {
      if (!targetMarkets.includes(market.market)) continue;

      const ev = estimateEV(market.probability);
      // Only show opportunities with real edge
      if (market.probability < 60 || ev <= 0) continue;

      const score = calculateOpportunityScore(market.probability, ev, pressure);

      opportunities.push({
        matchId: match.id,
        match: `${match.homeTeam} vs ${match.awayTeam}`,
        minute,
        league: match.league,
        opportunity: market.market,
        probability: market.probability,
        ev: Math.round(ev * 100) / 100,
        pressure: Math.round(pressure),
        score: Math.round(score * 100) / 100,
        signal: hasGoalSignal ? '🔥 GOL IMINENTE' : null,
        isLive,
      });
    }

    // Add imminent goal as standalone opportunity for live
    if (hasGoalSignal) {
      const existingGoalOpp = opportunities.find(o => o.matchId === match.id && o.signal);
      if (!existingGoalOpp) {
        opportunities.push({
          matchId: match.id,
          match: `${match.homeTeam} vs ${match.awayTeam}`,
          minute,
          league: match.league,
          opportunity: 'Próximo Gol',
          probability: Math.min(85, 60 + Math.round(pressure * 0.25)),
          ev: 0.05,
          pressure: Math.round(pressure),
          score: 0.80,
          signal: '🔥 GOL IMINENTE',
          isLive: true,
        });
      }
    }
  }

  // Sort by score descending
  opportunities.sort((a, b) => b.score - a.score);

  // Allow multiple markets per match, deduplicate only same market+match, max 10
  const seen = new Set<string>();
  const top: ScannerOpportunity[] = [];
  for (const opp of opportunities) {
    const key = `${opp.matchId}-${opp.opportunity}`;
    if (seen.has(key)) continue;
    seen.add(key);
    top.push(opp);
    if (top.length >= 10) break;
  }

  return top;
}
