import { describe, expect, it } from 'vitest';
import {
  isValidObservedMarketEvidence,
  normalizeResearchEvidence,
  summarizeResearchEvidence,
} from './researchEvidence';

describe('research evidence layer', () => {
  it('keeps web facts observed without turning them into model values', () => {
    const evidence = normalizeResearchEvidence({
      type: 'INJURY',
      sourceType: 'WEB',
      sourceName: 'Example News',
      sourceUrl: 'https://example.com/match',
      observedAt: '2026-09-15T20:00:00Z',
      observed: true,
      estimated: false,
      confidence: 90,
      claim: 'Titular está fora por lesão',
    });
    expect(evidence.sourceType).toBe('WEB');
    expect(evidence.observed).toBe(true);
    expect(evidence.estimated).toBe(false);
  });

  it('accepts an observed market odd only with explicit MARKET provenance', () => {
    const evidence = normalizeResearchEvidence({
      type: 'ODDS',
      sourceType: 'MARKET',
      sourceName: 'Observed bookmaker feed',
      observedAt: '2026-09-15T20:00:00Z',
      observed: true,
      estimated: false,
      confidence: 95,
      claim: 'Over 2.5 goals',
      value: 2.1,
    });
    expect(isValidObservedMarketEvidence(evidence)).toBe(true);
  });

  it('rejects a model-derived odd even when the number looks valid', () => {
    const evidence = normalizeResearchEvidence({
      type: 'ODDS',
      sourceType: 'MODEL',
      sourceName: 'Nexus model',
      observedAt: '2026-09-15T20:00:00Z',
      observed: false,
      estimated: true,
      confidence: 99,
      claim: 'Over 2.5 goals',
      value: 2.1,
    });
    expect(isValidObservedMarketEvidence(evidence)).toBe(false);
  });

  it('summarizes provenance without mixing estimated and observed data', () => {
    const result = summarizeResearchEvidence([
      { type: 'FORM', sourceType: 'WEB', sourceName: 'Source A', claim: 'form', observed: true, estimated: false, confidence: 80 },
      { type: 'ODDS', sourceType: 'MARKET', sourceName: 'Book A', claim: 'odd', observed: true, estimated: false, confidence: 90, value: 2 },
      { type: 'H2H', sourceType: 'MODEL', sourceName: 'Nexus', claim: 'estimate', observed: false, estimated: true, confidence: 60 },
    ]);
    expect(result.total).toBe(3);
    expect(result.observed).toBe(2);
    expect(result.estimated).toBe(1);
    expect(result.web).toBe(1);
    expect(result.marketObserved).toBe(1);
  });
});
