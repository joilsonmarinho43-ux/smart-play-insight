import { describe, expect, it } from 'vitest';
import type { MarketAnalysis } from '@/types/match';
import type { HybridSignal } from '@/lib/hybridEngine';
import { adaptHybridSignal, adaptPreMatch } from '@/lib/nexusAdapters';

const market: MarketAnalysis = {
  market: 'Over 0.5 HT',
  probability: 88,
  risk: 'baixo',
  category: 'goals',
};

const sniper: HybridSignal = {
  matchId: 'h1',
  match: 'Casa vs Fora',
  league: 'Teste',
  minute: 18,
  tier: 'SNIPER',
  label: 'SNIPER 🔥',
  confidence: 'alta',
  market: 'Over 0.5 HT',
  signalEligible: true,
  signalReason: 'Cenário LIVE atende aos filtros SNIPER',
  shotsOnGoal: 4,
  totalShots: 8,
  corners: 3,
  dangerousAttacks: 12,
  daEstimated: false,
  possession: 64,
  pressure: 90,
  homeGoals: 0,
  awayGoals: 0,
  observedAt: new Date().toISOString(),
};

const strongPreMatch = {
  id: 'p1',
  time: '20:00',
  league: 'Teste',
  homeTeam: 'Casa',
  awayTeam: 'Fora',
  isLive: false,
  sampleSize: { homeGames: 5, awayGames: 5, homeWithStats: 5, awayWithStats: 5 },
  modelData: {
    homeGoalsAvg: 1.5,
    awayGoalsAvg: 1.2,
    homeGoalsAgainstAvg: 1.0,
    awayGoalsAgainstAvg: 1.1,
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

describe('Nexus adapters', () => {
  it('adapta um sinal Hybrid forte sem criar semântica de execução', () => {
    const result = adaptHybridSignal(sniper, market);
    expect(result.decision).toBe('SIGNAL');
    expect(result.signalEligible).toBe(true);
    expect(result.selectedMarket?.market).toBe('Over 0.5 HT');
  });

  it('rejeita LIVE quando a proveniência temporal está ausente', () => {
    const result = adaptHybridSignal({ ...sniper, observedAt: undefined }, market);
    expect(result.decision).toBe('REJECT');
    expect(result.signalEligible).toBe(false);
    expect(result.reasonCodes).toContain('DATA_LIVE_TIMESTAMP_MISSING');
  });

  it('nunca promove sinal Hybrid bloqueado para sinal analítico', () => {
    const result = adaptHybridSignal({ ...sniper, signalEligible: false }, market);
    expect(result.signalEligible).toBe(false);
    expect(result.decision).toBe('REJECT');
    expect(result.reasonCodes).toContain('ANALYSIS_BLOCKED');
  });

  it('não converte confiança padrão em sinal forte', () => {
    const result = adaptHybridSignal({ ...sniper, confidence: 'padrão' }, market);
    expect(result.signalEligible).toBe(false);
    expect(result.decision).toBe('INFO_ONLY');
    expect(result.reasonCodes).toContain('CONFIDENCE_MISSING');
  });

  it('mantém pré-jogo forte quando há amostra e contexto de modelo suficientes', () => {
    const result = adaptPreMatch(strongPreMatch, [market], 88);
    expect(result.decision).toBe('SIGNAL');
    expect(result.signalEligible).toBe(true);
  });

  it('não promove pré-jogo com amostra histórica insuficiente', () => {
    const result = adaptPreMatch(
      { ...strongPreMatch, sampleSize: { homeGames: 2, awayGames: 5, homeWithStats: 2, awayWithStats: 5 } },
      [market],
      88,
    );
    expect(result.decision).toBe('REJECT');
    expect(result.reasonCodes).toContain('DATA_INSUFFICIENT_SAMPLE');
  });
});
