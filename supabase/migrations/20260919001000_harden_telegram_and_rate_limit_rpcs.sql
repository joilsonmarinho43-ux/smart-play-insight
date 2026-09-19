-- Restrict SECURITY DEFINER operational RPCs that are used by trusted
-- server-side functions only. Public EXECUTE would allow callers to mutate
-- privileged state or consume advisory locks outside the intended pipeline.

REVOKE ALL ON FUNCTION public.acquire_cache_lock(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_cache_lock(text)
  TO service_role;

REVOKE ALL ON FUNCTION public.check_rate_limit(text, text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, text, integer, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.cleanup_rate_limits()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_rate_limits()
  TO service_role;

-- This RPC performs its own admin check and is intended for the authenticated
-- admin analytics surface. Keep EXECUTE available to authenticated users while
-- retaining the in-function authorization gate.
REVOKE ALL ON FUNCTION public.get_signal_context_analytics(integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_signal_context_analytics(integer)
  TO authenticated;
