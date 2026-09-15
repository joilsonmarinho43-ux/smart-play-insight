export type ResearchEvidenceType =
  | 'INJURY'
  | 'SUSPENSION'
  | 'LINEUP'
  | 'FORM'
  | 'H2H'
  | 'MOTIVATION'
  | 'REFEREE'
  | 'WEATHER'
  | 'ODDS'
  | 'OTHER';

export type ResearchSourceType = 'API' | 'WEB' | 'MODEL' | 'MARKET';

export interface ResearchEvidence {
  type: ResearchEvidenceType;
  sourceType: ResearchSourceType;
  sourceName: string;
  sourceUrl?: string | null;
  observedAt: string;
  observed: boolean;
  estimated: boolean;
  confidence: number;
  claim: string;
  value?: string | number | boolean | null;
}

export interface ResearchEvidenceInput {
  type: ResearchEvidenceType;
  sourceType: ResearchSourceType;
  sourceName?: string;
  sourceUrl?: string | null;
  observedAt?: string;
  observed?: boolean;
  estimated?: boolean;
  confidence?: number;
  claim: string;
  value?: string | number | boolean | null;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));

export function normalizeResearchEvidence(input: ResearchEvidenceInput): ResearchEvidence {
  const observedAt = input.observedAt && !Number.isNaN(Date.parse(input.observedAt))
    ? new Date(input.observedAt).toISOString()
    : new Date(0).toISOString();

  return {
    type: input.type,
    sourceType: input.sourceType,
    sourceName: input.sourceName?.trim() || 'unknown',
    sourceUrl: input.sourceUrl ?? null,
    observedAt,
    observed: input.observed === true,
    estimated: input.estimated === true,
    confidence: Math.round(clamp(input.confidence ?? 0)),
    claim: input.claim.trim(),
    value: input.value ?? null,
  };
}

export function isValidObservedMarketEvidence(evidence: ResearchEvidence): boolean {
  return evidence.type === 'ODDS'
    && evidence.sourceType === 'MARKET'
    && evidence.observed === true
    && evidence.estimated === false
    && evidence.confidence >= 70
    && evidence.sourceName !== 'unknown'
    && !Number.isNaN(Date.parse(evidence.observedAt));
}

export function summarizeResearchEvidence(evidence: ResearchEvidence[]): {
  total: number;
  observed: number;
  estimated: number;
  web: number;
  marketObserved: number;
  currentMarketObserved: ResearchEvidence[];
} {
  const normalized = evidence.map(normalizeResearchEvidence);
  return {
    total: normalized.length,
    observed: normalized.filter(e => e.observed).length,
    estimated: normalized.filter(e => e.estimated).length,
    web: normalized.filter(e => e.sourceType === 'WEB').length,
    marketObserved: normalized.filter(isValidObservedMarketEvidence).length,
    currentMarketObserved: normalized.filter(isValidObservedMarketEvidence),
  };
}
