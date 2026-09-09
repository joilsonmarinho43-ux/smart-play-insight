import type { MarketAnalysis, MatchData } from '@/types/match';
import {
  decideNexus,
  marketsToNexusEvidence,
  type NexusDecisionOutput,
  type NexusEvidence,
  type NexusMode,
} from '@/lib/nexusDecisionCore';
import type { HybridSignal } from '@/lib/hybridEngine';

/**
 * Adapters do Nexus.
 *
 * Regra: adapters normalizam saídas dos engines para análise. Eles não
 * executam apostas, não gerenciam exposição e não conectam a plataformas.
 */

const HYBRID_CONFIDENCE: Record<HybridSignal['confidence'], number | null> = {
  alta: 90,
  média: 75,
  // "padrão" não é uma confiança numérica explícita. Deve permanecer
  // ausente para que o Core aplique INFO_ONLY, nunca REJECT por score 0.
  padrão: null,
};

function hybridEvidence(signal: HybridSignal): NexusEvidence[] {
  const estimatedPenalty = signal.daEstimated ? 0.75 : 1;
  return [
    { source: 'engine', name: 'hybrid_pressure', value: signal.pressure, weight: 1 },
    { source: 'live', name: 'shots_on_goal', value: signal.shotsOnGoal * 10, weight: 1 },
    { source: 'live', name: 'corners', value: signal.corners * 10, weight: 1 },
    { source: 'live', name: 'possession', value: signal.possession, weight: 1 },
    { source: 'live', name: 'dangerous_attacks', value: Math.min(100, signal.dangerousAttacks * 5), weight: estimatedPenalty },
  ];
}

export function adaptHybridSignal(
  signal: HybridSignal,
  market?: MarketAnalysis,
): NexusDecisionOutput {
  const match: Pick<MatchData, 'id' | 'homeTeam' | 'awayTeam' | 'league' | 'isLive' | 'status' | 'minute'> = {
    id: signal.matchId,
    homeTeam: signal.match.split(' vs ')[0] || signal.match,
    awayTeam: signal.match.split(' vs ')[1] || '',
    league: signal.league,
    isLive: true,
    status: 'LIVE',
    minute: signal.minute,
  };

  const markets = market ? [market] : [];
  const evidence = hybridEvidence(signal);
  const engineConflict = signal.canExecute === false && signal.tier !== 'NORMAL';

  return decideNexus({
    match,
    mode: 'LIVE' satisfies NexusMode,
    confidence: HYBRID_CONFIDENCE[signal.confidence],
    markets,
    evidence: [
      ...evidence,
      ...marketsToNexusEvidence(markets),
    ],
    // Compatibilidade com o engine: canExecute significa apenas que o
    // engine considera o sinal elegível; aqui isso vira bloqueio ANALÍTICO.
    analysisBlocked: !signal.canExecute,
    engineConflict,
  });
}

/** Adapta uma análise pré-jogo sem acoplar o engine ao Core. */
export function adaptPreMatch(
  match: MatchData,
  markets: MarketAnalysis[],
  confidence: number | null | undefined,
): NexusDecisionOutput {
  return decideNexus({
    match,
    mode: 'PRE_MATCH',
    confidence,
    markets,
    evidence: marketsToNexusEvidence(markets),
  });
}
