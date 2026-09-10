-- Prediction outcomes are authoritative calibration data.
-- Clients must never be able to manufacture WIN/LOSS outcomes.

DROP POLICY IF EXISTS "Users can resolve own predictions" ON public.prediction_ledger;

REVOKE UPDATE ON public.prediction_ledger FROM authenticated;
REVOKE UPDATE ON public.prediction_ledger FROM anon;

-- Keep history immutable to clients. Resolution is performed only by the
-- trusted resolver using service_role/server-side credentials.
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

-- Explicitly document that only the trusted backend role may resolve rows.
GRANT UPDATE (outcome, resolved_at) ON public.prediction_ledger TO service_role;
