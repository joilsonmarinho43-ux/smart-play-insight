-- Harden operational Telegram RPCs: these functions read/write privileged
-- Telegram telemetry and alert state and are invoked only by trusted server jobs.

REVOKE ALL ON FUNCTION public.aggregate_telegram_metrics(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aggregate_telegram_metrics(text)
  TO service_role;

REVOKE ALL ON FUNCTION public.alert_should_fire(text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.alert_should_fire(text, integer)
  TO service_role;
