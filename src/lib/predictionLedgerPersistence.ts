import type { MarketAnalysis } from '@/types/match';
import type { NexusDecisionOutput } from '@/lib/nexusDecisionCore';
import { createPredictionRecord, type PredictionRecord } from '@/lib/predictionLedger';

export interface LedgerPersistenceInput {
  predictionId: string;
  matchId: string;
  decision: NexusDecisionOutput;
  market: MarketAnalysis;
  modelVersion: string;
  dataQualityScore: number;
  dataQualityStatus: 'VALID' | 'DEGRADED' | 'REJECT';
  predictedAt?: string;
  dataObservedAt?: string | null;
}

/**
 * Converts an authoritative Nexus analytical decision into an immutable
 * ledger record. This function has no database side effects.
 *
 * Only SIGNAL decisions with a genuine model probability can enter the
 * prediction ledger. LIVE heuristic probabilities remain audit data and are
 * intentionally rejected here.
 */
export function buildLedgerPrediction(input: LedgerPersistenceInput): PredictionRecord | null {
  if (input.decision.decision !== 'SIGNAL' || !input.decision.signalEligible) return null;
  if (input.decision.reasonCodes.includes('DATA_QUALITY_REJECT')) return null;
  if (input.market.probabilitySource !== 'MODEL_ESTIMATE') return null;
  if (input.dataQualityStatus !== 'VALID') return null;

  const predictedAt = input.predictedAt ?? new Date().toISOString();

  return createPredictionRecord({
    predictionId: input.predictionId,
    matchId: input.matchId,
    market: input.market.market,
    probability: input.market.probability,
    confidence: input.decision.confidence,
    modelVersion: input.modelVersion,
    mode: 'PRE_MATCH',
    probabilitySource: 'MODEL_ESTIMATE',
    calibrationStatus: input.market.calibrationStatus ?? 'UNCALIBRATED',
    marketOdd: input.market.odd ?? null,
    predictedAt,
    dataObservedAt: input.dataObservedAt ?? null,
    dataQualityScore: input.dataQualityScore,
    dataQualityStatus: input.dataQualityStatus,
  });
}
