import { describe, expect, it } from 'vitest';
import { assessDataQuality } from '@/lib/dataQuality';
import type { MatchData } from '@/types/match';

const preMatch: MatchData = {
  id: 'm1', time: '20:00', league: 'Test League', homeTeam: 'Alpha', awayTeam: 'Beta',
  metrics: {
    possession: [55, 45], xG: [1.2, 0.9], totalShots: [10, 8], shotsOnTarget: [4, 3],
    bigChances: [2, 1], corners: [5, 3], offsides: [1, 2], fouls: [8, 10], yellowCards: [1, 2],
  },
  modelData: {
    homeGoalsAvg: 1.6, awayGoalsAvg: 1.1, homeCornersAvg: 5, awayCornersAvg: 4,
    homeCardsAvg: 2, awayCardsAvg: 2, homeCornersVariance: 1, awayCornersVariance: 1,
    homeCardsVariance: 1, awayCardsVariance: 1,
  },
  sampleSize: { homeGames: 10, awayGames: 10, homeWithStats: 10, awayWithStats: 10 },
};

const live: MatchData = {
  id: 'm2', time: '20:00', league: 'Test League', homeTeam: 'Alpha', awayTeam: 'Beta',
  isLive: true, status: '1H', minute: 22, liveScore: { home: 0, away: 0 },
  liveStats: {
    dangerousAttacks: [25, 14], corners: [3, 1], possession: [61, 39], pressureIndex: [72, 51],
  },
};

describe('dataQuality', () => {
  it('accepts complete pre-match data as high quality', () => {
    const result = assessDataQuality(preMatch, 'PRE_MATCH');
    expect(result.level).toBe('HIGH');
    expect(result.signalEligible).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('blocks strong pre-match qualification with an insufficient sample', () => {
    const result = assessDataQuality({ ...preMatch, sampleSize: { ...preMatch.sampleSize!, homeGames: 2, awayGames: 2 } }, 'PRE_MATCH');
    expect(result.reasons).toContain('INSUFFICIENT_SAMPLE');
    expect(result.signalEligible).toBe(false);
  });

  it('fails closed when LIVE freshness is unknown', () => {
    const result = assessDataQuality(live, 'LIVE', { now: 1_000_000 });
    expect(result.reasons).toContain('LIVE_FRESHNESS_UNKNOWN');
    expect(result.signalEligible).toBe(false);
  });

  it('rejects stale LIVE data', () => {
    const result = assessDataQuality(live, 'LIVE', { now: 200_000, observedAt: 100_000, liveMaxAgeMs: 90_000 });
    expect(result.reasons).toContain('LIVE_DATA_STALE');
    expect(result.signalEligible).toBe(false);
    expect(result.freshnessMs).toBe(100_000);
  });

  it('does not authorize estimated data for a strong signal', () => {
    const result = assessDataQuality(preMatch, 'PRE_MATCH', { estimatedData: true });
    expect(result.reasons).toContain('ESTIMATED_DATA');
    expect(result.signalEligible).toBe(false);
  });
});
