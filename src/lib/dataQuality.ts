/**
 * Data Quality Gate for Nexus analytics.
 *
 * This layer measures whether the data is trustworthy enough for a strong
 * analytical signal. It never creates a probability and never executes an
 * order. It is intentionally fail-closed when critical LIVE freshness is
 * unknown or stale.
 */

import type { MatchData } from '@/types/match';

export type DataQualityLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'REJECT';

export interface DataQualityOptions {
  /** Unix timestamp (ms) when the current dataset was observed by the client. */
  observedAt?: number | null;
  now?: number;
  /** Maximum accepted age for LIVE data. Default: 90 seconds. */
  liveMaxAgeMs?: number;
  /** Marks data assembled from estimates/fallbacks rather than direct source data. */
  estimatedData?: boolean;
}

export interface DataQualityResult {
  score: number;
  level: DataQualityLevel;
  signalEligible: boolean;
  reasons: string[];
  sampleSize: number;
  freshnessMs: number | null;
}

const clamp = (value: number): number => Math.max(0, Math.min(100, value));

function finitePair(pair: [number, number] | null | undefined): boolean {
  return !!pair && pair.every((value) => Number.isFinite(value) && value >= 0);
}

function sampleCount(match: MatchData): number {
  const sample = match.sampleSize;
  if (!sample) return 0;
  return Math.min(
    Number.isFinite(sample.homeGames) ? sample.homeGames : 0,
    Number.isFinite(sample.awayGames) ? sample.awayGames : 0,
  );
}

/** Deterministic, side-effect-free quality gate. */
export function assessDataQuality(
  match: MatchData,
  mode: 'PRE_MATCH' | 'LIVE',
  options: DataQualityOptions = {},
): DataQualityResult {
  const reasons: string[] = [];
  let score = 100;
  const sample = sampleCount(match);
  const now = options.now ?? Date.now();
  const maxLiveAge = options.liveMaxAgeMs ?? 90_000;

  if (!match.id || !match.homeTeam || !match.awayTeam || !match.league) {
    return {
      score: 0,
      level: 'REJECT',
      signalEligible: false,
      reasons: ['IDENTITY_INCOMPLETE'],
      sampleSize: sample,
      freshnessMs: null,
    };
  }

  if (mode === 'LIVE') {
    if (match.isLive !== true) {
      reasons.push('LIVE_STATE_UNCONFIRMED');
      score -= 60;
    }

    if (typeof match.minute !== 'number' || !Number.isFinite(match.minute) || match.minute < 0) {
      reasons.push('LIVE_MINUTE_MISSING');
      score -= 25;
    }

    if (!match.liveScore || !finitePair([match.liveScore.home, match.liveScore.away])) {
      reasons.push('LIVE_SCORE_MISSING');
      score -= 15;
    }

    const observedAt = options.observedAt;
    if (typeof observedAt !== 'number' || !Number.isFinite(observedAt) || observedAt <= 0) {
      reasons.push('LIVE_FRESHNESS_UNKNOWN');
      score -= 40;
    } else {
      const freshnessMs = now - observedAt;
      if (freshnessMs < 0) {
        reasons.push('LIVE_TIMESTAMP_IN_FUTURE');
        score -= 40;
      } else if (freshnessMs > maxLiveAge) {
        reasons.push('LIVE_DATA_STALE');
        score -= 60;
      }
    }

    const live = match.liveStats;
    if (!live) {
      reasons.push('LIVE_STATS_MISSING');
      score -= 20;
    } else {
      if (!finitePair(live.dangerousAttacks)) reasons.push('DANGEROUS_ATTACKS_INVALID');
      if (!finitePair(live.corners)) reasons.push('CORNERS_INVALID');
      if (!finitePair(live.possession)) reasons.push('POSSESSION_INVALID');
      if (!finitePair(live.pressureIndex)) reasons.push('PRESSURE_INVALID');
      if (reasons.some((r) => r.endsWith('_INVALID'))) score -= 25;
    }
  } else {
    if (sample < 3) {
      reasons.push('INSUFFICIENT_SAMPLE');
      score -= 45;
    } else if (sample < 5) {
      reasons.push('SMALL_SAMPLE');
      score -= 15;
    }

    if (!match.modelData) {
      reasons.push('MODEL_DATA_MISSING');
      score -= 20;
    }

    if (!match.metrics) {
      reasons.push('MATCH_METRICS_MISSING');
      score -= 10;
    }
  }

  if (options.estimatedData) {
    reasons.push('ESTIMATED_DATA');
    score -= 20;
  }

  score = clamp(score);
  let level: DataQualityLevel = score >= 85 ? 'HIGH' : score >= 65 ? 'MEDIUM' : score >= 40 ? 'LOW' : 'REJECT';

  // A LIVE feed with unknown/stale freshness cannot support a strong signal,
  // regardless of how complete the remaining fields look.
  if (mode === 'LIVE' && (reasons.includes('LIVE_FRESHNESS_UNKNOWN') || reasons.includes('LIVE_DATA_STALE'))) {
    level = score < 40 ? 'REJECT' : 'LOW';
  }

  const signalEligible = level === 'HIGH' && !reasons.includes('ESTIMATED_DATA');

  return {
    score,
    level,
    signalEligible,
    reasons,
    sampleSize: sample,
    freshnessMs:
      typeof options.observedAt === 'number' && Number.isFinite(options.observedAt)
        ? now - options.observedAt
        : null,
  };
}
