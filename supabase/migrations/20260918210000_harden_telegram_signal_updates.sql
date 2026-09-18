-- NEXUS 33 — published signal ledger update hardening
-- A signal may be resolved/annotated by trusted server workers, but its
-- decision provenance must never be rewritten after publication.

REVOKE INSERT ON public.telegram_signals FROM authenticated;
REVOKE INSERT ON public.telegram_signals FROM anon;
REVOKE UPDATE ON public.telegram_signals FROM authenticated;
REVOKE UPDATE ON public.telegram_signals FROM anon;
REVOKE DELETE ON public.telegram_signals FROM authenticated;
REVOKE DELETE ON public.telegram_signals FROM anon;

GRANT UPDATE ON public.telegram_signals TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_telegram_signal_update_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  jwt_role text := COALESCE(current_setting('request.jwt.claim.role', true), '');
BEGIN
  IF current_user <> 'service_role' AND jwt_role <> 'service_role' THEN
    RAISE EXCEPTION 'TELEGRAM_SIGNAL_SERVICE_ONLY';
  END IF;

  -- Resolution workers may update operational/outcome fields only.
  -- Core decision fields are immutable once the signal is published.
  IF NEW.match_id IS DISTINCT FROM OLD.match_id
     OR NEW.match_name IS DISTINCT FROM OLD.match_name
     OR NEW.market IS DISTINCT FROM OLD.market
     OR NEW.market_type IS DISTINCT FROM OLD.market_type
     OR NEW.league IS DISTINCT FROM OLD.league
     OR NEW.minute IS DISTINCT FROM OLD.minute
     OR NEW.confidence IS DISTINCT FROM OLD.confidence
     OR NEW.model_probability IS DISTINCT FROM OLD.model_probability
     OR NEW.implied_probability IS DISTINCT FROM OLD.implied_probability
     OR NEW.expected_value IS DISTINCT FROM OLD.expected_value
     OR NEW.odd IS DISTINCT FROM OLD.odd
     OR NEW.sensitivity IS DISTINCT FROM OLD.sensitivity
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.rma_verdict IS DISTINCT FROM OLD.rma_verdict
     OR NEW.rma_score IS DISTINCT FROM OLD.rma_score
     OR NEW.probability_source IS DISTINCT FROM OLD.probability_source
     OR NEW.calibration_status IS DISTINCT FROM OLD.calibration_status
     OR NEW.odd_source IS DISTINCT FROM OLD.odd_source
     OR NEW.core_approved IS DISTINCT FROM OLD.core_approved
     OR NEW.core_reason_codes IS DISTINCT FROM OLD.core_reason_codes
  THEN
    RAISE EXCEPTION 'TELEGRAM_SIGNAL_CORE_FIELDS_IMMUTABLE';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_telegram_signal_update_integrity
ON public.telegram_signals;

CREATE TRIGGER trg_telegram_signal_update_integrity
BEFORE UPDATE ON public.telegram_signals
FOR EACH ROW
EXECUTE FUNCTION public.enforce_telegram_signal_update_integrity();
