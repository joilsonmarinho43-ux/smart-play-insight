/**
 * Nexus Data Quality Gate
 * Pure, fail-closed validation for analytical inputs.
 * This layer never executes orders and never invents missing data.
 */

export type DataQualityStatus = 'VALID' | 'DEGRADED' | 'REJECT';

export interface DataQualityInput {
  sampleSize?: number | null;
  requiredSampleSize?: number;
  observedAt?: string | Date | null;
  now?: string | Date;
  maxAgeSeconds?: number;
  sourceCompleteness?: number | null;
  estimatedData?: boolean;
  live?: boolean;
  requiredFeaturesPresent?: boolean;
}

export interface DataQualityResult {
  status: DataQualityStatus;
  score: number;
  reasons: string[];
  ageSeconds: number | null;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number) => Math.max(0, Math.min(100, v));

function parseTime(value: string | Date | null | undefined): number | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/**
 * Live data is rejected when its timestamp cannot be established or is stale.
 * Missing sample/features are rejected rather than silently downgraded.
 */
export function assessDataQuality(input: DataQualityInput): DataQualityResult {
  const reasons: string[] = [];
  const nowMs = parseTime(input.now) ?? Date.now();
  const observedMs = parseTime(input.observedAt);
  const maxAge = input.maxAgeSeconds ?? (input.live ? 120 : 12 * 60 * 60);
  const ageSeconds = observedMs === null ? null : Math.max(0, (nowMs - observedMs) / 1000);

  if (input.live && ageSeconds === null) reasons.push('LIVE_TIMESTAMP_MISSING');
  if (ageSeconds !== null && ageSeconds > maxAge) reasons.push('DATA_STALE');
  if (input.requiredFeaturesPresent === false) reasons.push('REQUIRED_FEATURES_MISSING');
  if (input.estimatedData === true) reasons.push('ESTIMATED_DATA');

  const completeness = input.sourceCompleteness;
  if (completeness !== undefined && completeness !== null && (!finite(completeness) || completeness < 0 || completeness > 100)) {
    reasons.push('INVALID_SOURCE_COMPLETENESS');
  } else if (finite(completeness) && completeness < 90) {
    reasons.push('SOURCE_INCOMPLETE');
  }

  const sample = input.sampleSize;
  const required = input.requiredSampleSize ?? 3;
  if (sample !== undefined && sample !== null && (!finite(sample) || sample < 0)) reasons.push('INVALID_SAMPLE_SIZE');
  if (sample !== undefined && sample !== null && sample < required) reasons.push('INSUFFICIENT_SAMPLE');

  const hardReject = reasons.some((r) => [
    'LIVE_TIMESTAMP_MISSING', 'DATA_STALE', 'REQUIRED_FEATURES_MISSING',
    'INVALID_SOURCE_COMPLETENESS', 'INVALID_SAMPLE_SIZE', 'INSUFFICIENT_SAMPLE',
  ].includes(r));

  let score = 100;
  if (reasons.includes('SOURCE_INCOMPLETE')) score -= 15;
  if (reasons.includes('ESTIMATED_DATA')) score -= 20;
  if (reasons.includes('INSUFFICIENT_SAMPLE')) score -= 35;
  score = clamp(score);

  if (hardReject) return { status: 'REJECT', score, reasons, ageSeconds };
  if (reasons.length) return { status: 'DEGRADED', score, reasons, ageSeconds };
  return { status: 'VALID', score, reasons: [], ageSeconds };
}
