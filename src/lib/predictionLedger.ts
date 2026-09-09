import { validProbability } from './probabilityIntegrity';
import type { CalibrationStatus, ProbabilitySource } from '@/types/match';

export type PredictionOutcome = boolean | null;

/** Immutable provenance record for every analytical prediction. */
export interface PredictionRecord {
  predictionId: string;
  matchId: string;
  market: string;
  probability: number;
  confidence: number;
  modelVersion: string;
  mode: 'PRE_MATCH' | 'LIVE';
  probabilitySource: ProbabilitySource;
  calibrationStatus: CalibrationStatus;
  marketOdd: number | null;
  predictedAt: string;
  dataObservedAt: string | null;
  dataQualityScore: number;
  dataQualityStatus: 'VALID' | 'DEGRADED' | 'REJECT';
  outcome: PredictionOutcome;
  resolvedAt: string | null;
}

export function createPredictionRecord(
  input: Omit<PredictionRecord, 'outcome' | 'resolvedAt'>,
): PredictionRecord | null {
  if (!input.predictionId || !input.matchId || !input.market || !input.modelVersion) return null;
  if (validProbability(input.probability) === null) return null;
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 100) return null;
  if (!Number.isFinite(input.dataQualityScore) || input.dataQualityScore < 0 || input.dataQualityScore > 100) return null;
  if (!Number.isFinite(Date.parse(input.predictedAt))) return null;
  if (input.dataObservedAt !== null && !Number.isFinite(Date.parse(input.dataObservedAt))) return null;
  if (input.marketOdd !== null && (!Number.isFinite(input.marketOdd) || input.marketOdd <= 1)) return null;

  return { ...input, outcome: null, resolvedAt: null };
}

/** Resolution is append-style: it returns a new record and never mutates history. */
export function resolvePrediction(record: PredictionRecord, outcome: boolean, resolvedAt: string): PredictionRecord | null {
  if (!Number.isFinite(Date.parse(resolvedAt)) || record.outcome !== null) return null;
  if (Date.parse(resolvedAt) < Date.parse(record.predictedAt)) return null;
  return { ...record, outcome, resolvedAt };
}

export function resolvedObservations(records: PredictionRecord[]) {
  return records
    .filter((r) => r.outcome !== null)
    .map((r) => ({ probability: r.probability, occurred: r.outcome as boolean }));
}
