CREATE TABLE IF NOT EXISTS public.telegram_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  window_label text NOT NULL,
  total_sent integer NOT NULL DEFAULT 0,
  total_failed integer NOT NULL DEFAULT 0,
  total_retried integer NOT NULL DEFAULT 0,
  total_dead integer NOT NULL DEFAULT 0,
  outbox_pending integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_telegram_metrics_created_at
  ON public.telegram_metrics (created_at DESC);

ALTER TABLE public.telegram_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read telegram metrics"
  ON public.telegram_metrics FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE TABLE IF NOT EXISTS public.telegram_alert_state (
  alert_key text PRIMARY KEY,
  last_fired_at timestamptz NOT NULL DEFAULT now(),
  last_payload jsonb
);

ALTER TABLE public.telegram_alert_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read alert state"
  ON public.telegram_alert_state FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.aggregate_telegram_metrics(_window text DEFAULT '5min')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _interval interval;
  _sent int := 0; _failed int := 0; _retried int := 0; _dead int := 0; _pending int := 0;
  _since timestamptz;
BEGIN
  _interval := CASE _window WHEN '1min' THEN interval '1 minute'
                            WHEN '5min' THEN interval '5 minutes'
                            ELSE interval '5 minutes' END;
  _since := now() - _interval;

  SELECT COUNT(*) FILTER (WHERE success = true),
         COUNT(*) FILTER (WHERE success = false)
    INTO _sent, _failed
    FROM public.telegram_signals
   WHERE created_at >= _since;

  SELECT COUNT(*) FILTER (WHERE status = 'dead'),
         COUNT(*) FILTER (WHERE status = 'pending' AND attempts > 0)
    INTO _dead, _retried
    FROM public.telegram_outbox
   WHERE updated_at >= _since;

  SELECT COUNT(*) INTO _pending
    FROM public.telegram_outbox WHERE status = 'pending';

  INSERT INTO public.telegram_metrics
    (window_label, total_sent, total_failed, total_retried, total_dead, outbox_pending)
  VALUES (_window, _sent, _failed, _retried, _dead, _pending);

  RETURN jsonb_build_object('window', _window, 'sent', _sent, 'failed', _failed,
                            'retried', _retried, 'dead', _dead, 'pending', _pending);
END;
$$;

CREATE OR REPLACE FUNCTION public.retry_telegram_outbox_message(_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _row public.telegram_outbox%ROWTYPE;
BEGIN
  SELECT * INTO _row FROM public.telegram_outbox WHERE id = _id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  UPDATE public.telegram_outbox
     SET status = 'pending',
         next_retry_at = now(),
         max_attempts = GREATEST(max_attempts, attempts + 1),
         updated_at = now()
   WHERE id = _id;

  RETURN jsonb_build_object('ok', true, 'id', _id,
                            'previous_status', _row.status,
                            'attempts', _row.attempts);
END;
$$;

CREATE OR REPLACE FUNCTION public.alert_should_fire(_alert_key text, _cooldown_minutes int DEFAULT 10)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _last timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('alert:' || _alert_key, 0));
  SELECT last_fired_at INTO _last FROM public.telegram_alert_state WHERE alert_key = _alert_key;
  IF _last IS NOT NULL AND _last > now() - make_interval(mins => _cooldown_minutes) THEN
    RETURN false;
  END IF;
  INSERT INTO public.telegram_alert_state (alert_key, last_fired_at)
  VALUES (_alert_key, now())
  ON CONFLICT (alert_key) DO UPDATE SET last_fired_at = now();
  RETURN true;
END;
$$;