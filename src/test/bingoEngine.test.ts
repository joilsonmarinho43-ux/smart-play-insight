import { describe, expect, it } from 'vitest';
import { generatePreGameBingo } from '@/lib/bingoEngine';
import type { MatchData } from '@/types/match';

const match: MatchData = {
  id: 'bingo-test-1',
  time: '20:00',
  league: 'Premier League',
  homeTeam: 'Alpha',
  awayTeam: 'Beta',
  isLive: false,
  sampleSize: { homeGames: 6, awayGames: 6 },
  modelData: {
    homeGoalsAvg: 1.7,
    awayGoalsAvg: 1.5,
    homeGoalsAgainstAvg: 1.1,
    awayGoalsAgainstAvg: 1.2,
  },
};

describe('Bingo confidence gate', () => {
  it('fails closed when confidence is missing', () => {
    expect(generatePreGameBingo(match)).toBeNull();
  });

  it('fails closed for non-finite confidence', () => {
    expect(generatePreGameBingo(match, Number.NaN)).toBeNull();
    expect(generatePreGameBingo(match, Number.POSITIVE_INFINITY)).toBeNull();
  });
});
