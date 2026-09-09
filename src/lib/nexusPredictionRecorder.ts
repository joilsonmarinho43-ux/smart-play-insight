import { supabase } from '@/integrations/supabase/client';
import { analyzeMarkets } from '@/lib/matchAnalysis';
import { adaptPreMatch } from '@/lib/nexusAdapters';
import { buildLedgerPrediction } from '@/lib/predictionLedgerPersistence';
import { resolveConfidence } from '@/lib/confidencePolicy';
import type { MatchData } from '@/types/match';

const MODEL_VERSION = 'poisson-xg-bayes-v1';

/**
 * Production boundary for authoritative Nexus pre-match predictions.
 *
 * It records only a Core-approved SIGNAL backed by MODEL_ESTIMATE provenance.
 * It never places orders, calls a bookmaker, or fabricates market prices.
 * Duplicate prediction IDs are treated as idempotent success.
 */
export async function recordNexusPreMatchPrediction(match: MatchData): Promise<{
  recorded: boolean;
  reason: string;
}> {
  if (!match.id || match.isLive) return { recorded: false, reason: 'NOT_PRE_MATCH' };

  try {
    const confidence = await resolveConfidence({
      matchId: String(match.id),
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      league: match.league,
      kickoffISO: match.time,
    });

    if (!Number.isFinite(confidence.score) || confidence.score < 85) {
      return { recorded: false, reason: 'CONFIDENCE_BELOW_SIGNAL_THRESHOLD' };
    }

    const markets = analyzeMarkets(match);
    const decision = adaptPreMatch(match, markets, confidence.score);

    if (decision.decision !== 'SIGNAL' || !decision.selectedMarket) {
      return { recorded: false, reason: `CORE_${decision.decision}` };
    }

    const ledgerRecord = buildLedgerPrediction({
      predictionId: `nexus:${String(match.id)}:${decision.selectedMarket.market}`,
      matchId: String(match.id),
      decision,
      market: decision.selectedMarket,
      modelVersion: MODEL_VERSION,
      dataQualityScore: 100,
      dataQualityStatus: 'VALID',
      predictedAt: new Date().toISOString(),
      dataObservedAt: null,
    });

    if (!ledgerRecord) return { recorded: false, reason: 'LEDGER_GATE_REJECTED' };

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return { recorded: false, reason: 'AUTH_REQUIRED' };

    const { error } = await (supabase.from as any)('prediction_ledger').insert({
      prediction_id: ledgerRecord.predictionId,
      user_id: userId,
      match_id: ledgerRecord.matchId,
      market: ledgerRecord.market,
      probability: ledgerRecord.probability,
      confidence: ledgerRecord.confidence,
      model_version: ledgerRecord.modelVersion,
      mode: ledgerRecord.mode,
      probability_source: ledgerRecord.probabilitySource,
      calibration_status: ledgerRecord.calibrationStatus,
      market_odd: ledgerRecord.marketOdd,
      predicted_at: ledgerRecord.predictedAt,
      data_observed_at: ledgerRecord.dataObservedAt,
      data_quality_score: ledgerRecord.dataQualityScore,
      data_quality_status: ledgerRecord.dataQualityStatus,
    });

    if (error) {
      if (error.code === '23505') return { recorded: false, reason: 'ALREADY_RECORDED' };
      console.error('[NEXUS-LEDGER] insert failed:', error);
      return { recorded: false, reason: 'PERSISTENCE_ERROR' };
    }

    return { recorded: true, reason: 'RECORDED' };
  } catch (error) {
    console.error('[NEXUS-LEDGER] recorder failed:', error);
    return { recorded: false, reason: 'RECORDER_ERROR' };
  }
}
