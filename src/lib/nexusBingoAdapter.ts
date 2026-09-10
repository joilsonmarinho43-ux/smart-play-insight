import type { MatchData, MarketAnalysis } from '@/types/match';
import { decideNexus, marketsToNexusEvidence, type NexusDecisionOutput } from '@/lib/nexusDecisionCore';
import type { BingoResult } from '@/lib/bingoEngine';

/** Bingo is legacy candidate generation only; its outputs are never treated as calibrated model probabilities. */
function asHeuristic(markets: MarketAnalysis[]): MarketAnalysis[] {
  return markets.map((market) => ({ ...market, probabilitySource: 'HEURISTIC', calibrationStatus: 'UNCALIBRATED' }));
}

export function adaptBingoResult(match: MatchData, bingo: BingoResult, confidence?: number | null): NexusDecisionOutput {
  const markets = asHeuristic(bingo.markets.filter((market) => Number.isFinite(market.probability) && market.probability >= 0 && market.probability <= 100));
  return decideNexus({
    match,
    mode: match.isLive === true ? 'LIVE' : 'PRE_MATCH',
    confidence,
    markets,
    evidence: [...marketsToNexusEvidence(markets), { source: 'engine', name: 'bingo_candidate_score', value: Number.isFinite(bingo.avgConfidence) ? bingo.avgConfidence : 0, weight: 1 }],
    analysisBlocked: true,
  });
}

export function adaptBingoMarkets(match: MatchData, markets: MarketAnalysis[], confidence: number | null | undefined, analysisBlocked = false): NexusDecisionOutput {
  const validMarkets = asHeuristic(markets.filter((market) => Number.isFinite(market.probability) && market.probability >= 0 && market.probability <= 100));
  return decideNexus({
    match,
    mode: match.isLive === true ? 'LIVE' : 'PRE_MATCH',
    confidence,
    markets: validMarkets,
    evidence: marketsToNexusEvidence(validMarkets),
    analysisBlocked: true || analysisBlocked,
  });
}
