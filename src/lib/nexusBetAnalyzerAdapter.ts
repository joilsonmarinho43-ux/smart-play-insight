import type { MarketAnalysis, MatchData } from '@/types/match';
import {
  decideNexus,
  type NexusDecisionOutput,
} from '@/lib/nexusDecisionCore';
import type { ScenarioCard } from '@/lib/betAnalyzerEngine';

/**
 * Adapter do Bet Analyzer para o Nexus Core.
 *
 * ScenarioCard.score é um score interno do cenário, NÃO uma probabilidade de
 * mercado. Ele entra somente como evidência de engine e nunca é convertido
 * artificialmente em MarketAnalysis/probabilidade.
 *
 * O Core classifica a oportunidade para fins analíticos. Não há autorização,
 * colocação de aposta, gestão de stake ou conexão com plataforma externa.
 */
export function adaptBetAnalyzerCard(
  card: ScenarioCard,
  match: MatchData,
  confidence: number | null | undefined,
  options?: { market?: MarketAnalysis; analysisBlocked?: boolean },
): NexusDecisionOutput {
  const market = options?.market;

  return decideNexus({
    match,
    mode: match.isLive === true ? 'LIVE' : 'PRE_MATCH',
    confidence,
    markets: market ? [market] : [],
    evidence: [
      {
        source: 'engine',
        name: `bet_analyzer_${card.scenario.key}`,
        value: card.score,
        weight: 1,
      },
      {
        source: 'model',
        name: 'bet_analyzer_quality',
        value: card.quality === 'ALTA' ? 100 : card.quality === 'MÉDIA' ? 75 : 50,
        weight: 0.5,
      },
    ],
    analysisBlocked: options?.analysisBlocked,
  });
}
