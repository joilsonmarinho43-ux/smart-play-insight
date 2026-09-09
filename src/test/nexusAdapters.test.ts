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
  observedAt: '2026-09-09T01:55:00Z',
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

  it('mantém pré-jogo separado do adapter LIVE', () => {
    const result = adaptPreMatch(
      { id: 'p1', time: '20:00', league: 'Teste', homeTeam: 'Casa', awayTeam: 'Fora', isLive: false },
      [market],
      88,
    );
    expect(result.decision).toBe('SIGNAL');
    expect(result.signalEligible).toBe(true);
  });
});
