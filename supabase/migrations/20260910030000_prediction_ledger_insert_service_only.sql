-- Calibration history must not be writable by an authenticated browser client.
-- A client can otherwise construct a syntactically valid prediction and poison calibration.
DROP POLICY IF EXISTS "Users can insert own predictions" ON public.prediction_ledger;
REVOKE INSERT ON public.prediction_ledger FROM authenticated;
REVOKE INSERT ON public.prediction_ledger FROM anon;
GRANT INSERT ON public.prediction_ledger TO service_role;

CREATE OR REPLACE FUNCTION public.prevent_prediction_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  jwt_role text := COALESCE(current_setting('request.jwt.claim.role', true), '');
BEGIN
  IF current_user <> 'service_role' AND jwt_role <> 'service_role' THEN
    RAISE EXCEPTION 'PREDICTION_INSERT_SERVICE_ONLY';
  END IF;

  IF NEW.outcome IS NOT NULL OR NEW.resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'PREDICTION_MUST_START_UNRESOLVED';
  END IF;

  IF NEW.probability_source IS DISTINCT FROM 'MODEL_ESTIMATE'
     OR NEW.calibration_status IS DISTINCT FROM 'CALIBRATED'
     OR NEW.data_quality_status IS DISTINCT FROM 'VALID'
     OR COALESCE(NEW.confidence, 0) < 85 THEN
    RAISE EXCEPTION 'PREDICTION_NOT_CORE_ELIGIBLE';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prediction_ledger_service_insert ON public.prediction_ledger;
CREATE TRIGGER prediction_ledger_service_insert
BEFORE INSERT ON public.prediction_ledger
FOR EACH ROW
EXECUTE FUNCTION public.prevent_prediction_insert();
