REVOKE ALL ON FUNCTION public.aggregate_telegram_metrics(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_telegram_outbox_message(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.alert_should_fire(text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aggregate_telegram_metrics(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_telegram_outbox_message(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.alert_should_fire(text, int) TO service_role;