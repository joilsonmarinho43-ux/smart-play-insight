-- Prediction outcomes are calibration evidence, not user-editable state.
-- Only the trusted service-role resolver may write outcome/resolved_at.

DROP POLICY IF EXISTS "Users can resolve own predictions" ON public.prediction_ledger;

CREATE OR REPLACE FUNCTION public.prevent_prediction_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  jwt_role text := COALESCE(current_setting('request.jwt.claim.role', true), '');
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

  IF jwt_role <> 'service_role' THEN
    RAISE EXCEPTION 'PREDICTION_RESOLUTION_SERVICE_ONLY';
  END IF;

  IF NEW.outcome IS NULL OR NEW.resolved_at IS NULL THEN
    RAISE EXCEPTION 'PREDICTION_RESOLUTION_REQUIRES_OUTCOME';
  END IF;

  IF NEW.resolved_at < OLD.predicted_at THEN
    RAISE EXCEPTION 'PREDICTION_RESOLUTION_BEFORE_PREDICTION';
  END IF;

  RETURN NEW;
END;
$$;

-- Defense in depth: there should be no UPDATE path for normal authenticated users.
DROP POLICY IF EXISTS "Users can update own predictions" ON public.prediction_ledger;
DROP POLICY IF EXISTS "Users can resolve own predictions" ON public.prediction_ledger;
