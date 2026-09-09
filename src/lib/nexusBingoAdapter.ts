import type { MatchData, MarketAnalysis } from '@/types/match';
import {
  decideNexus,
  marketsToNexusEvidence,
  type NexusDecisionOutput,
} from '@/lib/nexusDecisionCore';
import type { BingoResult } from '@/lib/bingoEngine';

/**
 * Adapter do Bingo para o Nexus Core.
 *
 * O Bingo continua responsável apenas por selecionar mercados candidatos.
 * O Core recebe os mercados reais e a confiança explícita para decidir se a
 * oportunidade pode avançar. Ausência de confidenceScore permanece segura:
 * o Core não autoriza execução sem confiança explícita.
 */
export function adaptBingoResult(
  match: MatchData,
  bingo: BingoResult,
  confidence?: number | null,
): NexusDecisionOutput {
  const markets = bingo.markets.filter(
    (market) => Number.isFinite(market.probability) && market.probability >= 0 && market.probability <= 100,
  );

  const evidence = [
    ...marketsToNexusEvidence(markets),
    {
      source: 'engine' as const,
      name: 'bingo_avg_confidence',
      value: Number.isFinite(bingo.avgConfidence) ? bingo.avgConfidence : 0,
      weight: 1,
    },
  ];

  return decideNexus({
    match,
    mode: match.isLive === true ? 'LIVE' : 'PRE_MATCH',
    confidence,
    markets,
    evidence,
    executionBlocked: bingo.confidenceMode === 'discard' || bingo.confidenceMode === 'info_only',
  });
}

/**
 * Conveniência para o fluxo que já possui os mercados selecionados.
 * Mantém a mesma regra: confidence precisa ser explícita para EXECUTE.
 */
export function adaptBingoMarkets(
  match: MatchData,
  markets: MarketAnalysis[],
  confidence: number | null | undefined,
  executionBlocked = false,
): NexusDecisionOutput {
  const validMarkets = markets.filter(
    (market) => Number.isFinite(market.probability) && market.probability >= 0 && market.probability <= 100,
  );

  return decideNexus({
    match,
    mode: match.isLive === true ? 'LIVE' : 'PRE_MATCH',
    confidence,
    markets: validMarkets,
    evidence: marketsToNexusEvidence(validMarkets),
    executionBlocked,
  });
}
