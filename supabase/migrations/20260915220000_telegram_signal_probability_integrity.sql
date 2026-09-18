-- NEXUS 33 — ledger hardening
-- Keep model probability separate from market-implied probability.
-- Historical correct-score broadcasts used the model fair probability for both
-- fields. Those rows must not enter calibration/EV datasets as independent
-- market observations.

create or replace function public.sanitize_telegram_signal_probabilities()
returns trigger
language plpgsql
as $$
begin
  if new.model_probability is not null
     and new.implied_probability is not null
     and abs(new.model_probability - new.implied_probability) < 0.0001
     and (new.expected_value is null or new.market_type = 'correct_score') then
    new.model_probability := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_telegram_signal_probability_integrity
on public.telegram_signals;

create trigger trg_telegram_signal_probability_integrity
before insert or update on public.telegram_signals
for each row
execute function public.sanitize_telegram_signal_probabilities();

-- Remove the already-known invalid equality from the calibration dataset.
-- Keep the original market-implied probability for historical reporting.
update public.telegram_signals
set model_probability = null
where model_probability is not null
  and implied_probability is not null
  and abs(model_probability - implied_probability) < 0.0001
  and (expected_value is null or market_type = 'correct_score');


-- Preserve the provenance used by the Core gate so the signal ledger is
-- independently auditable after publication.
alter table public.telegram_signals
  add column if not exists probability_source text,
  add column if not exists calibration_status text,
  add column if not exists odd_source text,
  add column if not exists core_approved boolean,
  add column if not exists core_reason_codes jsonb;

create index if not exists idx_telegram_signals_odd_source
  on public.telegram_signals (odd_source);

create index if not exists idx_telegram_signals_probability_source
  on public.telegram_signals (probability_source);


-- Defense in depth: the signal ledger is server-owned. Browser roles must not
-- be able to manufacture or mutate published signals outside the Core path.
REVOKE INSERT ON public.telegram_signals FROM authenticated;
REVOKE INSERT ON public.telegram_signals FROM anon;
REVOKE UPDATE ON public.telegram_signals FROM authenticated;
REVOKE UPDATE ON public.telegram_signals FROM anon;
GRANT INSERT, UPDATE ON public.telegram_signals TO service_role;

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
     OR NEW.odd IS NULL
     OR NEW.odd <= 1
     OR NEW.expected_value IS NULL
     OR NEW.expected_value <= 0 THEN
    RAISE EXCEPTION 'TELEGRAM_SIGNAL_CORE_INTEGRITY_FAILED';
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
