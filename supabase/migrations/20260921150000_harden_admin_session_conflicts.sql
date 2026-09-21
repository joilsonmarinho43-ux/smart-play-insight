-- NEXUS 33 — admin conflict acknowledgement through a guarded RPC.
-- Browser roles remain read-only on session state; acknowledgement is a
-- privileged admin operation performed by a SECURITY DEFINER function.

CREATE OR REPLACE FUNCTION public.mark_session_conflicts_seen(_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED';
  END IF;

  UPDATE public.session_conflicts
  SET seen = true
  WHERE id = ANY(_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_session_conflicts_seen(uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_session_conflicts_seen(uuid[])
  TO authenticated;

-- RMA telemetry is an administrative read surface only.
ALTER TABLE public.rma_shadow_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read RMA shadow logs" ON public.rma_shadow_logs;

CREATE POLICY "Admins can read RMA shadow logs"
ON public.rma_shadow_logs
FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));
