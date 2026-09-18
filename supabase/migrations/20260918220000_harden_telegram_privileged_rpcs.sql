-- NEXUS 33 — privileged Telegram RPC hardening
-- Legacy SECURITY DEFINER helpers must not be callable by browser roles.
-- The trusted backend keeps EXECUTE through service_role; scheduled cron
-- functions continue to run as their function owner.

-- Legacy signal claim/finalization helpers.
-- They are retained for compatibility, but no public/authenticated caller
-- may invoke them directly.
REVOKE ALL ON FUNCTION public.try_claim_telegram_slot(
  text, text, text, integer, integer, text, text, text, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_claim_telegram_slot(
  text, text, text, integer, integer, text, text, text, text, text, text, text
) TO service_role;

REVOKE ALL ON FUNCTION public.mark_telegram_signal_failed(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_telegram_signal_failed(uuid, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.mark_telegram_signal_sent(uuid, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_telegram_signal_sent(uuid, bigint)
  TO service_role;

-- Operational functions created as SECURITY DEFINER. They are invoked by
-- pg_cron/server-side workers, never by browser clients.
REVOKE ALL ON FUNCTION public.cleanup_old_dead_outbox()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_old_dead_outbox()
  TO service_role;

REVOKE ALL ON FUNCTION public.ops_health_monitor()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_health_monitor()
  TO service_role;

-- The outbox retry RPC was already restricted by an earlier migration.
-- Reassert the invariant here so this hardening migration is self-contained.
REVOKE ALL ON FUNCTION public.retry_telegram_outbox_message(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retry_telegram_outbox_message(uuid)
  TO service_role;
