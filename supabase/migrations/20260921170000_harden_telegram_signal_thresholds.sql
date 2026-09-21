-- NEXUS 33 — defense in depth for published signal thresholds.
-- Even trusted service-role inserts must satisfy the same conservative Core
-- threshold used by the application before entering the Telegram ledger.

CREATE OR REPLACE FUNCTION public.enforce_telegram_signal_core_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  jwt_role text := COALESCE(current_setting('request.jwt.claim.role', true), '');
BEGIN
  IF current_user <> 'service_role' AND jwt_role <> 'service_role' THEN
    RAISE EXCEPTION 'TELEGRAM_SIGNAL_SERVICE_ONLY';
  END IF;

  IF COALESCE(NEW.core_approved, false) IS NOT TRUE
     OR NEW.probability_source IS DISTINCT FROM 'MODEL_ESTIMATE'
     OR NEW.calibration_status NOT IN ('CALIBRATED', 'MODEL_VALIDATED')
     OR NEW.odd_source IS DISTINCT FROM 'OBSERVED'
     OR NEW.model_probability IS NULL
     OR NEW.model_probability < 75
     OR NEW.model_probability > 100
     OR NEW.confidence IS NULL
     OR NEW.confidence < 85
     OR NEW.confidence > 100
     OR NEW.odd IS NULL
     OR NEW.odd <= 1
     OR NEW.expected_value IS NULL
     OR NEW.expected_value <= 0 THEN
    RAISE EXCEPTION 'TELEGRAM_SIGNAL_CORE_THRESHOLD_FAILED';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_telegram_signal_core_insert
ON public.telegram_signals;

CREATE TRIGGER trg_telegram_signal_core_insert
BEFORE INSERT ON public.telegram_signals
FOR EACH ROW
EXECUTE FUNCTION public.enforce_telegram_signal_core_insert();
