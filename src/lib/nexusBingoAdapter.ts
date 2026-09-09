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
 * O Core classifica a oportunidade para análise. Nenhuma etapa executa
 * apostas ou gerencia exposição financeira.
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
    analysisBlocked: bingo.confidenceMode === 'discard' || bingo.confidenceMode === 'info_only',
  });
}

/**
 * Conveniência para o fluxo que já possui os mercados selecionados.
 * Confidence continua opcional na API, mas ausência nunca produz sinal forte.
 */
export function adaptBingoMarkets(
  match: MatchData,
  markets: MarketAnalysis[],
  confidence: number | null | undefined,
  analysisBlocked = false,
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
    analysisBlocked,
  });
}
