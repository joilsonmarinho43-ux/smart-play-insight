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
  mode?: 'PRE_MATCH' | 'LIVE';
  predictedAt?: string;
  dataObservedAt?: string | null;
}

/** Only an authoritative, calibrated Core SIGNAL can enter calibration history. */
export function buildLedgerPrediction(input: LedgerPersistenceInput): PredictionRecord | null {
  if (input.decision.decision !== 'SIGNAL' || !input.decision.signalEligible) return null;
  if (input.decision.reasonCodes.includes('DATA_QUALITY_REJECT')) return null;
  if (input.market.probabilitySource !== 'MODEL_ESTIMATE') return null;
  if (input.market.calibrationStatus !== 'CALIBRATED') return null;
  if (input.dataQualityStatus !== 'VALID') return null;
  if (!Number.isFinite(input.market.probability) || input.market.probability <= 0 || input.market.probability > 100) return null;
  if (!Number.isFinite(input.decision.confidence) || input.decision.confidence < 85) return null;

  return createPredictionRecord({
    predictionId: input.predictionId,
    matchId: input.matchId,
    market: input.market.market,
    probability: input.market.probability,
    confidence: input.decision.confidence,
    modelVersion: input.modelVersion,
    mode: input.mode ?? 'PRE_MATCH',
    probabilitySource: 'MODEL_ESTIMATE',
    calibrationStatus: 'CALIBRATED',
    marketOdd: input.market.odd ?? null,
    predictedAt: input.predictedAt ?? new Date().toISOString(),
    dataObservedAt: input.dataObservedAt ?? null,
    dataQualityScore: input.dataQualityScore,
    dataQualityStatus: input.dataQualityStatus,
  });
}
