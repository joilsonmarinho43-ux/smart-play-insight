-- NEXUS 33 — Telegram outbox DML hardening
-- The outbox is a server-side queue. Browser roles must never be able
-- to create, mutate, or delete delivery jobs. Admin UI retains read-only
-- access through its existing SELECT RLS policy.

REVOKE INSERT ON public.telegram_outbox FROM PUBLIC, anon, authenticated;
REVOKE UPDATE ON public.telegram_outbox FROM PUBLIC, anon, authenticated;
REVOKE DELETE ON public.telegram_outbox FROM PUBLIC, anon, authenticated;

GRANT INSERT, UPDATE, DELETE ON public.telegram_outbox TO service_role;

-- Defense in depth: even if a future RLS policy is accidentally broadened,
-- the browser roles still have no table-level DML privilege.
