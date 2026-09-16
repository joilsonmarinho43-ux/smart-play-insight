import { describe, expect, it } from 'vitest';
import { analyzeMarkets } from './matchAnalysis';
import { decideNexus } from './nexusDecisionCore';
import type { MatchData } from '@/types/match';

const match: MatchData = {
  id: 'fixture-test', time: '2026-09-16T20:00:00Z', league: 'Test League', homeTeam: 'Home', awayTeam: 'Away',
  sampleSize: { homeGames: 5, awayGames: 5, homeWithStats: 5, awayWithStats: 5 },
  modelData: {
    homeGoalsAvg: 1.8, awayGoalsAvg: 1.4, homeGoalsAgainstAvg: 0.8, awayGoalsAgainstAvg: 1.2,
    homeCornersAvg: null, awayCornersAvg: null, homeCardsAvg: null, awayCardsAvg: null,
    homeCornersVariance: null, awayCornersVariance: null, homeCardsVariance: null, awayCardsVariance: null,
    leagueAvg: 2.5, source: 'team-form:ESPN/TSDB', historicalSample: 5, dataQuality: 'VALID',
  },
};

describe('NEXUS quantitative pipeline', () => {
  it('produces model estimates only from a real sample and marks them structurally validated', () => {
    const markets = analyzeMarkets(match);
    expect(markets.length).toBeGreaterThan(0);
    const modelMarkets = markets.filter(m => m.probabilitySource === 'MODEL_ESTIMATE');
    expect(modelMarkets.length).toBeGreaterThan(0);
    expect(modelMarkets.every(m => m.calibrationStatus === 'MODEL_VALIDATED')).toBe(true);
  });

  it('never turns a derived Under market into a model signal candidate', () => {
    const markets = analyzeMarkets(match);
    const under = markets.find(m => m.market === 'Under 2.5 Gols');
    expect(under?.probabilitySource).toBe('DERIVED');
    expect(under?.calibrationStatus).toBe('UNCALIBRATED');
  });

  it('uses the validated model market as the decision candidate', () => {
    const markets = analyzeMarkets(match).map(m => ({ ...m, odd: 2.0 }));
    const decision = decideNexus({
      match, mode: 'PRE_MATCH', confidence: 90, markets,
      evidence: markets.map(m => ({ source: 'market', name: m.market, value: m.probability })),
      dataQuality: { status: 'VALID', score: 100, reasons: [] } as any,
      calibrationStatus: 'MODEL_VALIDATED', probabilitySource: 'MODEL_ESTIMATE',
    });
    expect(decision.selectedMarket?.probabilitySource).toBe('MODEL_ESTIMATE');
    expect(decision.selectedMarket?.calibrationStatus).toBe('MODEL_VALIDATED');
  });
});
