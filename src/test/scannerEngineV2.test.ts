import { describe, expect, it } from 'vitest';
import { scanMatchesV2 } from '@/lib/scannerEngineV2';
import type { MatchData } from '@/types/match';

const baseMatch: MatchData = {
  id: 'scanner-test-1',
  time: new Date(Date.now() + 86_400_000).toISOString(),
  league: 'Test League',
  homeTeam: 'Casa',
  awayTeam: 'Fora',
  sampleSize: { homeGames: 8, awayGames: 8, homeWithStats: 8, awayWithStats: 8 },
  modelData: {
    homeGoalsAvg: 1.7,
    awayGoalsAvg: 1.3,
    homeGoalsAgainstAvg: 0.9,
    awayGoalsAgainstAvg: 1.0,
    homeCornersAvg: 5,
    awayCornersAvg: 4,
    homeCardsAvg: 2,
    awayCardsAvg: 2,
    homeCornersVariance: 1,
    awayCornersVariance: 1,
    homeCardsVariance: 1,
    awayCardsVariance: 1,
  },
};

describe('scannerEngineV2', () => {
  it('does not invent EV when no market odd exists', () => {
    const results = scanMatchesV2([baseMatch]);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(result => result.ev === null)).toBe(true);
    expect(results.every(result => result.marketOdd === null)).toBe(true);
  });

  it('preserves a real observed odd for analytical EV', () => {
    const match = { ...baseMatch };
    const original = require('@/lib/matchAnalysis');
    const spy = vi.spyOn(original, 'analyzeMarkets').mockReturnValue([
      {
        market: 'Over 1.5 Gols',
        probability: 80,
        risk: 'medium',
        category: 'goals',
        odd: 1.60,
        probabilitySource: 'MODEL_ESTIMATE',
        calibrationStatus: 'UNCALIBRATED',
      },
    ]);

    const results = scanMatchesV2([match]);
    expect(results[0]?.ev).toBeCloseTo(0.28, 6);
    expect(results[0]?.marketOdd).toBe(1.6);
    spy.mockRestore();
  });
});
