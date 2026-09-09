-- Durable analytical prediction ledger.
-- This table records model outputs for calibration/audit only.
-- It does not execute trades or bets.

CREATE TABLE IF NOT EXISTS public.prediction_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  match_id TEXT NOT NULL,
  market TEXT NOT NULL,
  probability NUMERIC(6,3) NOT NULL CHECK (probability > 0 AND probability <= 100),
  confidence NUMERIC(5,2) NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
  model_version TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('PRE_MATCH', 'LIVE')),
  probability_source TEXT NOT NULL CHECK (probability_source IN ('MODEL_ESTIMATE', 'HEURISTIC', 'DERIVED', 'MARKET_IMPLIED', 'UNKNOWN')),
  calibration_status TEXT NOT NULL CHECK (calibration_status IN ('UNCALIBRATED', 'CALIBRATED')),
  market_odd NUMERIC(8,3) CHECK (market_odd IS NULL OR market_odd > 1),
  predicted_at TIMESTAMPTZ NOT NULL,
  data_observed_at TIMESTAMPTZ,
  data_quality_score NUMERIC(5,2) NOT NULL CHECK (data_quality_score >= 0 AND data_quality_score <= 100),
  data_quality_status TEXT NOT NULL CHECK (data_quality_status IN ('VALID', 'DEGRADED', 'REJECT')),
  outcome BOOLEAN,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (resolved_at IS NULL OR resolved_at >= predicted_at),
  CHECK (outcome IS NULL OR resolved_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS prediction_ledger_match_idx
  ON public.prediction_ledger (match_id, predicted_at DESC);

CREATE INDEX IF NOT EXISTS prediction_ledger_calibration_idx
  ON public.prediction_ledger (model_version, market, probability_source, calibration_status, predicted_at);

CREATE INDEX IF NOT EXISTS prediction_ledger_unresolved_idx
  ON public.prediction_ledger (outcome, predicted_at)
  WHERE outcome IS NULL;

ALTER TABLE public.prediction_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own predictions"
ON public.prediction_ledger FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can read own predictions"
ON public.prediction_ledger FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Admins can read all predictions"
ON public.prediction_ledger FOR SELECT
TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
);

CREATE POLICY "Users can resolve own predictions"
ON public.prediction_ledger FOR UPDATE
TO authenticated
USING (auth.uid() = user_id AND outcome IS NULL)
WITH CHECK (auth.uid() = user_id AND outcome IS NOT NULL AND resolved_at IS NOT NULL);

CREATE OR REPLACE FUNCTION public.prevent_prediction_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.outcome IS NOT NULL THEN
    RAISE EXCEPTION 'PREDICTION_ALREADY_RESOLVED';
  END IF;

  IF NEW.prediction_id IS DISTINCT FROM OLD.prediction_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.match_id IS DISTINCT FROM OLD.match_id
     OR NEW.market IS DISTINCT FROM OLD.market
     OR NEW.probability IS DISTINCT FROM OLD.probability
     OR NEW.confidence IS DISTINCT FROM OLD.confidence
     OR NEW.model_version IS DISTINCT FROM OLD.model_version
     OR NEW.mode IS DISTINCT FROM OLD.mode
     OR NEW.probability_source IS DISTINCT FROM OLD.probability_source
     OR NEW.calibration_status IS DISTINCT FROM OLD.calibration_status
     OR NEW.market_odd IS DISTINCT FROM OLD.market_odd
     OR NEW.predicted_at IS DISTINCT FROM OLD.predicted_at
     OR NEW.data_observed_at IS DISTINCT FROM OLD.data_observed_at
     OR NEW.data_quality_score IS DISTINCT FROM OLD.data_quality_score
     OR NEW.data_quality_status IS DISTINCT FROM OLD.data_quality_status
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'PREDICTION_HISTORY_IMMUTABLE';
  END IF;

  IF NEW.outcome IS NULL OR NEW.resolved_at IS NULL THEN
    RAISE EXCEPTION 'PREDICTION_RESOLUTION_REQUIRES_OUTCOME';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prediction_ledger_immutable_update ON public.prediction_ledger;
CREATE TRIGGER prediction_ledger_immutable_update
BEFORE UPDATE ON public.prediction_ledger
FOR EACH ROW
EXECUTE FUNCTION public.prevent_prediction_mutation();
