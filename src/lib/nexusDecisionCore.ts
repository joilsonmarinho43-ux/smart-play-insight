import type { MarketAnalysis, MatchData } from '@/types/match';

/**
 * Nexus Core de Decisão
 *
 * Camada pura de orquestração analítica. Não chama APIs, Supabase,
 * localStorage ou plataformas externas. O Core somente classifica a força
 * de uma oportunidade para exibição/uso analítico.
 *
 * Regra arquitetural: este módulo NÃO altera nem importa engines existentes.
 * Integração dos engines é feita somente por adapters.
 */

export type NexusDecision = 'SIGNAL' | 'CONSERVATIVE' | 'INFO_ONLY' | 'REJECT';
export type NexusMode = 'PRE_MATCH' | 'LIVE';
export type EvidenceSource = 'market' | 'engine' | 'live' | 'model';

export interface NexusEvidence {
  source: EvidenceSource;
  name: string;
  value: number;
  weight?: number;
  supports?: boolean;
}

export interface NexusDecisionInput {
  match: Pick<MatchData, 'id' | 'homeTeam' | 'awayTeam' | 'league' | 'isLive' | 'status' | 'minute'>;
  mode: NexusMode;
  confidence?: number | null;
  markets?: MarketAnalysis[];
  evidence?: NexusEvidence[];
  /** Bloqueio analítico: partida/mercado já processado ou não elegível. */
  analysisBlocked?: boolean;
  /** Sinaliza conflito material entre engines. */
  engineConflict?: boolean;
}

export interface NexusDecisionOutput {
  decision: NexusDecision;
  confidence: number;
  riskScore: number;
  selectedMarket: MarketAnalysis | null;
  reasonCodes: string[];
  evidenceScore: number;
  /** Indica somente que o cenário é forte o bastante para ser sinalizado. */
  signalEligible: boolean;
}

const clamp = (n: number, min = 0, max = 100): number =>
  Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));

const normalizeConfidence = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? clamp(value) : null;

function marketScore(markets: MarketAnalysis[]): number {
  const usable = markets
    .map((m) => Number(m.probability))
    .filter((v) => Number.isFinite(v) && v >= 0 && v <= 100);
  return usable.length ? Math.max(...usable) : 0;
}

function evidenceScore(evidence: NexusEvidence[]): number {
  const usable = evidence
    .map((e) => ({ value: clamp(e.value), weight: Math.max(0, e.weight ?? 1) }))
    .filter((e) => e.weight > 0);
  if (!usable.length) return 0;
  const totalWeight = usable.reduce((sum, e) => sum + e.weight, 0);
  return Math.round(usable.reduce((sum, e) => sum + e.value * e.weight, 0) / totalWeight);
}

function selectMarket(markets: MarketAnalysis[]): MarketAnalysis | null {
  return markets
    .filter((m) => Number.isFinite(m.probability) && m.probability >= 0 && m.probability <= 100)
    .sort((a, b) => b.probability - a.probability)[0] ?? null;
}

/** Deterministic analyst-only decision policy. */
export function decideNexus(input: NexusDecisionInput): NexusDecisionOutput {
  const reasons: string[] = [];
  const confidence = normalizeConfidence(input.confidence);
  const selectedMarket = selectMarket(input.markets ?? []);
  const bestMarketScore = marketScore(input.markets ?? []);
  const evScore = evidenceScore(input.evidence ?? []);

  if (!input.match.id || !input.match.homeTeam || !input.match.awayTeam) {
    return {
      decision: 'REJECT', confidence: confidence ?? 0, riskScore: 100,
      selectedMarket: null, reasonCodes: ['INVALID_MATCH'], evidenceScore: 0,
      signalEligible: false,
    };
  }

  if (input.analysisBlocked) {
    reasons.push('ANALYSIS_BLOCKED');
    return {
      decision: 'REJECT', confidence: confidence ?? 0, riskScore: 100,
      selectedMarket, reasonCodes: reasons, evidenceScore: evScore,
      signalEligible: false,
    };
  }

  if (input.engineConflict) reasons.push('ENGINE_CONFLICT');

  if (confidence === null) reasons.push('CONFIDENCE_MISSING');
  if (evScore < 55) reasons.push('INSUFFICIENT_EVIDENCE');
  if (!selectedMarket) reasons.push('NO_VALID_MARKET');
  else if (bestMarketScore < 72) reasons.push('MARKET_BELOW_THRESHOLD');

  // Segurança: ausência de confiança explícita nunca autoriza um sinal forte.
  if (confidence === null) {
    return {
      decision: 'INFO_ONLY', confidence: 0, riskScore: 80,
      selectedMarket, reasonCodes: reasons, evidenceScore: evScore,
      signalEligible: false,
    };
  }

  if (confidence < 50 || reasons.includes('INSUFFICIENT_EVIDENCE') || reasons.includes('NO_VALID_MARKET')) {
    return {
      decision: 'REJECT', confidence, riskScore: clamp(100 - Math.min(confidence, evScore)),
      selectedMarket, reasonCodes: reasons, evidenceScore: evScore,
      signalEligible: false,
    };
  }

  if (confidence < 70 || bestMarketScore < 72) {
    return {
      decision: 'INFO_ONLY', confidence, riskScore: clamp(100 - Math.min(confidence, bestMarketScore)),
      selectedMarket, reasonCodes: reasons, evidenceScore: evScore,
      signalEligible: false,
    };
  }

  if (input.engineConflict) {
    return {
      decision: 'CONSERVATIVE', confidence, riskScore: clamp(100 - Math.min(confidence, evScore)),
      selectedMarket, reasonCodes: reasons, evidenceScore: evScore,
      signalEligible: false,
    };
  }

  if (confidence < 85) {
    reasons.push('CONSERVATIVE_CONFIDENCE');
    return {
      decision: 'CONSERVATIVE', confidence, riskScore: clamp(100 - Math.min(confidence, bestMarketScore, evScore)),
      selectedMarket, reasonCodes: reasons, evidenceScore: evScore,
      signalEligible: false,
    };
  }

  if (input.mode === 'LIVE' && input.match.isLive !== true) {
    reasons.push('LIVE_STATE_UNCONFIRMED');
    return {
      decision: 'CONSERVATIVE', confidence, riskScore: clamp(100 - Math.min(confidence, bestMarketScore, evScore)),
      selectedMarket, reasonCodes: reasons, evidenceScore: evScore,
      signalEligible: false,
    };
  }

  reasons.push('CORE_APPROVED_SIGNAL');
  return {
    decision: 'SIGNAL', confidence, riskScore: clamp(100 - Math.min(confidence, bestMarketScore, evScore)),
    selectedMarket, reasonCodes: reasons, evidenceScore: evScore,
    signalEligible: true,
  };
}

/** Transforma mercados reais em evidência analítica Nexus. */
export function marketsToNexusEvidence(markets: MarketAnalysis[]): NexusEvidence[] {
  return markets
    .filter((m) => Number.isFinite(m.probability))
    .map((m) => ({ source: 'market', name: m.market, value: clamp(m.probability), weight: 1 }));
}
