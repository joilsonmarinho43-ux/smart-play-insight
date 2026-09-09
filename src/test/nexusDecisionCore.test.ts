import { describe, expect, it } from 'vitest';
import { decideNexus, marketsToNexusEvidence } from '@/lib/nexusDecisionCore';
import type { MarketAnalysis } from '@/types/match';

const match = {
  id: 'test-1', homeTeam: 'Home', awayTeam: 'Away', league: 'League', isLive: false,
};

const market: MarketAnalysis = {
  market: 'Over 1.5 Gols', probability: 90, risk: 'low', category: 'goals', odd: 1.2,
  probabilitySource: 'MODEL_ESTIMATE',
  calibrationStatus: 'UNCALIBRATED',
};

const strongEvidence = marketsToNexusEvidence([market, {
  ...market, market: 'BTTS', probability: 88,
}]);

describe('Nexus Core analítico', () => {
  it('rejeita confiança baixa', () => {
    const out = decideNexus({ match, mode: 'PRE_MATCH', confidence: 49, markets: [market], evidence: strongEvidence });
    expect(out.decision).toBe('REJECT');
    expect(out.signalEligible).toBe(false);
  });

  it('não sinaliza oportunidade forte sem confiança explícita', () => {
    const out = decideNexus({ match, mode: 'PRE_MATCH', markets: [market], evidence: strongEvidence });
    expect(out.decision).toBe('INFO_ONLY');
    expect(out.signalEligible).toBe(false);
    expect(out.reasonCodes).toContain('CONFIDENCE_MISSING');
  });

  it('mantém 70-84 como conservador', () => {
    const out = decideNexus({ match, mode: 'PRE_MATCH', confidence: 80, markets: [market], evidence: strongEvidence });
    expect(out.decision).toBe('CONSERVATIVE');
    expect(out.signalEligible).toBe(false);
  });

  it('bloqueia sinal quando há conflito entre engines', () => {
    const out = decideNexus({ match, mode: 'PRE_MATCH', confidence: 92, markets: [market], evidence: strongEvidence, engineConflict: true });
    expect(out.decision).toBe('CONSERVATIVE');
    expect(out.signalEligible).toBe(false);
    expect(out.reasonCodes).toContain('ENGINE_CONFLICT');
  });

  it('classifica somente estimativa de modelo forte e consistente como SIGNAL', () => {
    const out = decideNexus({ match, mode: 'PRE_MATCH', confidence: 92, markets: [market], evidence: strongEvidence });
    expect(out.decision).toBe('SIGNAL');
    expect(out.signalEligible).toBe(true);
    expect(out.reasonCodes).toContain('CORE_APPROVED_SIGNAL');
    expect(out.selectedMarket?.market).toBe('Over 1.5 Gols');
  });

  it('nunca promove probabilidade heurística a SIGNAL', () => {
    const heuristic = { ...market, probabilitySource: 'HEURISTIC' as const };
    const out = decideNexus({
      match,
      mode: 'PRE_MATCH',
      confidence: 95,
      markets: [heuristic],
      evidence: marketsToNexusEvidence([heuristic]),
    });
    expect(out.decision).toBe('CONSERVATIVE');
    expect(out.signalEligible).toBe(false);
    expect(out.reasonCodes).toContain('PROBABILITY_UNVERIFIED');
  });

  it('nunca trata probabilidade implícita de mercado como probabilidade do modelo', () => {
    const implied = { ...market, probabilitySource: 'MARKET_IMPLIED' as const };
    const out = decideNexus({
      match,
      mode: 'PRE_MATCH',
      confidence: 95,
      markets: [implied],
      evidence: marketsToNexusEvidence([implied]),
    });
    expect(out.decision).toBe('CONSERVATIVE');
    expect(out.signalEligible).toBe(false);
    expect(out.reasonCodes).toContain('MARKET_IMPLIED_NOT_MODEL_PROBABILITY');
  });

  it('usa consenso de mercados em vez de deixar o maior dominar', () => {
    const out = decideNexus({
      match,
      mode: 'PRE_MATCH',
      confidence: 92,
      markets: [
        { ...market, probability: 95 },
        { ...market, market: 'BTTS', probability: 60 },
        { ...market, market: 'Over 2.5 Gols', probability: 58 },
      ],
      evidence: marketsToNexusEvidence([
        { ...market, probability: 95 },
        { ...market, market: 'BTTS', probability: 60 },
        { ...market, market: 'Over 2.5 Gols', probability: 58 },
      ]),
    });
    expect(out.decision).toBe('INFO_ONLY');
    expect(out.reasonCodes).toContain('MARKET_BELOW_THRESHOLD');
  });

  it('degrada para CONSERVATIVE quando mercados divergem materialmente', () => {
    const out = decideNexus({
      match,
      mode: 'PRE_MATCH',
      confidence: 92,
      markets: [
        { ...market, probability: 95 },
        { ...market, market: 'BTTS', probability: 94 },
        { ...market, market: 'Over 2.5 Gols', probability: 70 },
      ],
      evidence: marketsToNexusEvidence([
        { ...market, probability: 95 },
        { ...market, market: 'BTTS', probability: 94 },
        { ...market, market: 'Over 2.5 Gols', probability: 70 },
      ]),
    });
    expect(out.decision).toBe('CONSERVATIVE');
    expect(out.signalEligible).toBe(false);
    expect(out.reasonCodes).toContain('MARKET_DISAGREEMENT');
  });

  it('exige estado live confirmado quando o modo é LIVE', () => {
    const out = decideNexus({ match, mode: 'LIVE', confidence: 92, markets: [market], evidence: strongEvidence });
    expect(out.decision).toBe('CONSERVATIVE');
    expect(out.signalEligible).toBe(false);
    expect(out.reasonCodes).toContain('LIVE_STATE_UNCONFIRMED');
  });

  it('bloqueia análise quando o cenário está marcado como bloqueado', () => {
    const out = decideNexus({ match, mode: 'PRE_MATCH', confidence: 95, markets: [market], evidence: strongEvidence, analysisBlocked: true });
    expect(out.decision).toBe('REJECT');
    expect(out.signalEligible).toBe(false);
    expect(out.reasonCodes).toContain('ANALYSIS_BLOCKED');
  });

  it('ignora probabilidades inválidas ao construir evidências', () => {
    const out = marketsToNexusEvidence([market, { ...market, probability: Number.NaN }]);
    expect(out).toHaveLength(1);
    expect(out[0].value).toBe(90);
  });
});
