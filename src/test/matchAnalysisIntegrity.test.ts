import { describe, expect, it } from 'vitest';
import { analyzeMarkets } from '@/lib/matchAnalysis';

const base = {
  id: 'fixture-1', time: '20:00', kickoff: '2026-09-10T20:00:00Z', league: 'Test',
  homeTeam: 'Home', awayTeam: 'Away',
  modelData: {
    homeGoalsAvg: 1.7, awayGoalsAvg: 1.3, homeGoalsAgainstAvg: 1.0, awayGoalsAgainstAvg: 1.1,
    homeCornersAvg: 5.2, awayCornersAvg: 4.8, homeCardsAvg: 2.2, awayCardsAvg: 2.1,
    homeCornersVariance: 1, awayCornersVariance: 1, homeCardsVariance: 1, awayCardsVariance: 1,
  },
  sampleSize: { homeGames: 5, awayGames: 5, homeWithStats: 5, awayWithStats: 5 },
};

describe('matchAnalysis integrity', () => {
  it('does not treat big chances as xG', () => {
    const match: any = { ...base, homeStats: { leagueAvg: 1.4, bigChances: 8 }, awayStats: { leagueAvg: 1.4, bigChances: 9 } };
    const markets = analyzeMarkets(match);
    expect(markets.some(m => m.probabilitySource === 'MODEL_ESTIMATE')).toBe(true);
    expect(markets.every(m => m.probability !== 99)).toBe(true);
  });

  it('does not fabricate a five-game sample when sample data is absent', () => {
    const match: any = { ...base, modelData: undefined, sampleSize: undefined, homeStats: { goalsFor: 2, goalsAgainst: 1, leagueAvg: 1.4 }, awayStats: { goalsFor: 2, goalsAgainst: 1, leagueAvg: 1.4 } };
    const markets = analyzeMarkets(match);
    expect(markets.filter(m => m.probabilitySource === 'MODEL_ESTIMATE')).toHaveLength(0);
  });

  it('marks live pressure as heuristic rather than model probability', () => {
    const match: any = { ...base, isLive: true, liveStats: { dangerousAttacks: [20, 10], shotsOnGoal: [4, 2], corners: [3, 2], possession: [55, 45], pressureIndex: [70, 40] } };
    const pressure = analyzeMarkets(match).find(m => m.category === 'live_pressure');
    expect(pressure?.probabilitySource).toBe('HEURISTIC');
    expect(pressure?.calibrationStatus).toBe('UNCALIBRATED');
  });
});
