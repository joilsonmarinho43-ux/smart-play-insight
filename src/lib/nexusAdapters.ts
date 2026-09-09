import type { MarketAnalysis, MatchData } from '@/types/match';
import {
  decideNexus,
  marketsToNexusEvidence,
  type NexusDecisionOutput,
  type NexusEvidence,
  type NexusMode,
} from '@/lib/nexusDecisionCore';
import { assessDataQuality } from '@/lib/dataQualityGate';
import type { HybridSignal } from '@/lib/hybridEngine';

/**
 * Adapters do Nexus.
 *
 * Regra: adapters normalizam saídas dos engines para análise. Eles não
 * executam apostas, não gerenciam exposição e não conectam a plataformas.
 */

const HYBRID_CONFIDENCE: Record<HybridSignal['confidence'], number | null> = {
  alta: 90,
  média: 75,
  padrão: null,
};

function hybridEvidence(signal: HybridSignal): NexusEvidence[] {
  const estimatedPenalty = signal.daEstimated ? 0.75 : 1;
  return [
    { source: 'engine', name: 'hybrid_pressure', value: signal.pressure, weight: 1 },
    { source: 'live', name: 'shots_on_goal', value: signal.shotsOnGoal * 10, weight: 1 },
    { source: 'live', name: 'corners', value: signal.corners * 10, weight: 1 },
    { source: 'live', name: 'possession', value: signal.possession, weight: 1 },
    { source: 'live', name: 'dangerous_attacks', value: Math.min(100, signal.dangerousAttacks * 5), weight: estimatedPenalty },
  ];
}

export function adaptHybridSignal(
  signal: HybridSignal,
  market?: MarketAnalysis,
): NexusDecisionOutput {
  const match: Pick<MatchData, 'id' | 'homeTeam' | 'awayTeam' | 'league' | 'isLive' | 'status' | 'minute'> = {
    id: signal.matchId,
    homeTeam: signal.match.split(' vs ')[0] || signal.match,
    awayTeam: signal.match.split(' vs ')[1] || '',
    league: signal.league,
    isLive: true,
    status: 'LIVE',
    minute: signal.minute,
  };

  const markets = market ? [market] : [];
  const evidence = hybridEvidence(signal);
  const engineConflict = signal.signalEligible === false && signal.tier !== 'NORMAL';

  // LIVE is fail-closed: absence of an observation timestamp is itself a
  // provenance failure. We must never allow a live signal from an unknown-age
  // snapshot to reach the Core as if it were current.
  const dataQuality = assessDataQuality({
    live: true,
    observedAt: signal.observedAt ?? null,
    estimatedData: signal.daEstimated,
  });

  return decideNexus({
    match,
    mode: 'LIVE' satisfies NexusMode,
    confidence: HYBRID_CONFIDENCE[signal.confidence],
    markets,
    evidence: [
      ...evidence,
      ...marketsToNexusEvidence(markets),
    ],
    analysisBlocked: !signal.signalEligible,
    engineConflict,
    dataQuality,
  });
}

export function adaptPreMatch(
  match: MatchData,
  markets: MarketAnalysis[],
  confidence: number | null | undefined,
): NexusDecisionOutput {
  // PRE_MATCH also passes through the same quality gate. Unlike LIVE, missing
  // historical context is not automatically a timestamp failure, but a weak
  // sample/provenance must reduce or reject the analytical decision.
  const sampleSize = match.sampleSize
    ? Math.min(match.sampleSize.homeGames, match.sampleSize.awayGames)
    : null;

  const dataQuality = assessDataQuality({
    live: false,
    sampleSize,
    requiredSampleSize: 3,
    sourceCompleteness: match.modelData && match.sampleSize ? 100 : 75,
    requiredFeaturesPresent: markets.length > 0,
  });

  return decideNexus({
    match,
    mode: 'PRE_MATCH',
    confidence,
    markets,
    evidence: marketsToNexusEvidence(markets),
    dataQuality,
  });
}
