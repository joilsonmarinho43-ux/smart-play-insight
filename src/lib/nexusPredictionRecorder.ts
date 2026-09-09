import { supabase } from '@/integrations/supabase/client';
import { analyzeMarkets } from '@/lib/matchAnalysis';
import { adaptPreMatch } from '@/lib/nexusAdapters';
import { assessDataQuality } from '@/lib/dataQualityGate';
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
 *
 * Every gate returns an explicit diagnostic reason so a zero-row ledger can be
 * investigated from the Scanner without weakening any analytical threshold.
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
      // Scanner keeps `time` display-friendly; confidence needs the canonical
      // fixture timestamp when it is available.
      kickoffISO: match.kickoff ?? match.time,
    });

    console.info('[NEXUS-CONFIDENCE] resolution', {
      matchId: String(match.id),
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      score: confidence.score,
      source: confidence.source,
      diagnostic: confidence.diagnostic ?? 'NONE',
    });

    if (!Number.isFinite(confidence.score) || confidence.score < 85) {
      return {
        recorded: false,
        reason: `CONFIDENCE_BELOW_SIGNAL_THRESHOLD:${Number.isFinite(confidence.score) ? confidence.score : 'invalid'}:${confidence.source}:${confidence.diagnostic ?? 'NONE'}`,
      };
    }

    const markets = analyzeMarkets(match);
    if (markets.length === 0) {
      return { recorded: false, reason: 'NO_MARKETS' };
    }

    const decision = adaptPreMatch(match, markets, confidence.score);
    const sampleSize = match.sampleSize
      ? Math.min(match.sampleSize.homeGames, match.sampleSize.awayGames)
      : null;
    const quality = assessDataQuality({
      live: false,
      sampleSize,
      requiredSampleSize: 3,
      sourceCompleteness: match.modelData && match.sampleSize ? 100 : 75,
      requiredFeaturesPresent: markets.length > 0,
    });

    if (decision.decision !== 'SIGNAL' || !decision.selectedMarket) {
      const codes = decision.reasonCodes.length ? decision.reasonCodes.join('|') : 'NONE';
      const market = decision.selectedMarket?.market ?? 'NONE';
      return {
        recorded: false,
        reason: `CORE_${decision.decision}:markets=${markets.length}:selected=${market}:codes=${codes}:quality=${quality.status}:${quality.score}`,
      };
    }

    const ledgerRecord = buildLedgerPrediction({
      predictionId: `nexus:${String(match.id)}:${decision.selectedMarket.market}`,
      matchId: String(match.id),
      decision,
      market: decision.selectedMarket,
      modelVersion: MODEL_VERSION,
      dataQualityScore: quality.score,
      dataQualityStatus: quality.status,
      predictedAt: new Date().toISOString(),
      dataObservedAt: null,
    });

    if (!ledgerRecord) {
      return {
        recorded: false,
        reason: `LEDGER_GATE_REJECTED:source=${decision.selectedMarket.probabilitySource ?? 'UNKNOWN'}:quality=${quality.status}:${quality.score}:codes=${decision.reasonCodes.join('|') || 'NONE'}`,
      };
    }

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
      return { recorded: false, reason: `PERSISTENCE_ERROR:${error.code || 'UNKNOWN'}` };
    }

    return { recorded: true, reason: 'RECORDED' };
  } catch (error) {
    console.error('[NEXUS-LEDGER] recorder failed:', error);
    return { recorded: false, reason: `RECORDER_ERROR:${error instanceof Error ? error.message : 'UNKNOWN'}` };
  }
}