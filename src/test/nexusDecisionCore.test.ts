import { describe, expect, it } from 'vitest';
import { decideNexus, marketsToNexusEvidence } from '@/lib/nexusDecisionCore';
import type { MarketAnalysis } from '@/types/match';

const match = {
  id: 'test-1', homeTeam: 'Home', awayTeam: 'Away', league: 'League', isLive: false,
};

const market: MarketAnalysis = {
  market: 'Over 1.5 Gols', probability: 90, risk: 'low', category: 'goals', odd: 1.2,
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

  it('classifica somente cenário forte e consistente como SIGNAL', () => {
    const out = decideNexus({ match, mode: 'PRE_MATCH', confidence: 92, markets: [market], evidence: strongEvidence });
    expect(out.decision).toBe('SIGNAL');
    expect(out.signalEligible).toBe(true);
    expect(out.reasonCodes).toContain('CORE_APPROVED_SIGNAL');
    expect(out.selectedMarket?.market).toBe('Over 1.5 Gols');
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
