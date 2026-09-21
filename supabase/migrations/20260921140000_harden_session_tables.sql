-- NEXUS 33 — session state is server-managed.
-- The browser only needs SELECT on its own active session. Session registration
-- and conflict logging are performed by the register-session Edge Function
-- with service_role after validating the Supabase access token.

REVOKE INSERT ON public.active_sessions FROM authenticated;
REVOKE UPDATE ON public.active_sessions FROM authenticated;
REVOKE INSERT ON public.session_conflicts FROM authenticated;

GRANT SELECT ON public.active_sessions TO authenticated;
GRANT SELECT ON public.session_conflicts TO authenticated;

DROP POLICY IF EXISTS "Users can upsert own session" ON public.active_sessions;
DROP POLICY IF EXISTS "Users can update own session" ON public.active_sessions;
DROP POLICY IF EXISTS "Users can insert conflicts" ON public.session_conflicts;

-- Explicit service-role grants document the intended write path.
GRANT INSERT, UPDATE ON public.active_sessions TO service_role;
GRANT INSERT ON public.session_conflicts TO service_role;
