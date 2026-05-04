
-- 1) Auto-confirm existing users
UPDATE auth.users
   SET email_confirmed_at = now()
 WHERE email_confirmed_at IS NULL;

-- 2) Garantir trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3) telegram_outbox
CREATE TABLE IF NOT EXISTS public.telegram_outbox (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id         text NOT NULL,
  text            text NOT NULL,
  parse_mode      text NOT NULL DEFAULT 'HTML',
  source          text,
  signal_id       uuid,
  attempts        integer NOT NULL DEFAULT 0,
  max_attempts    integer NOT NULL DEFAULT 3,
  last_error      text,
  next_retry_at   timestamptz NOT NULL DEFAULT now(),
  delivered_at    timestamptz,
  status          text NOT NULL DEFAULT 'pending',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_telegram_outbox_pending
  ON public.telegram_outbox (next_retry_at) WHERE status = 'pending';
ALTER TABLE public.telegram_outbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read telegram outbox" ON public.telegram_outbox;
CREATE POLICY "Admins read telegram outbox" ON public.telegram_outbox
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

-- 4) Circuit breaker
CREATE TABLE IF NOT EXISTS public.api_circuit_state (
  service          text PRIMARY KEY,
  state            text NOT NULL DEFAULT 'CLOSED',
  failure_count    integer NOT NULL DEFAULT 0,
  opened_at        timestamptz,
  next_attempt_at  timestamptz,
  last_error       text,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.api_circuit_state (service, state) VALUES ('api_football', 'CLOSED')
  ON CONFLICT (service) DO NOTHING;
ALTER TABLE public.api_circuit_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read circuit state" ON public.api_circuit_state;
CREATE POLICY "Admins read circuit state" ON public.api_circuit_state
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.cb_check(_service text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _row public.api_circuit_state%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('cb:' || _service, 0));
  SELECT * INTO _row FROM public.api_circuit_state WHERE service = _service;
  IF NOT FOUND THEN
    INSERT INTO public.api_circuit_state (service) VALUES (_service) RETURNING * INTO _row;
  END IF;
  IF _row.state = 'OPEN' THEN
    IF _row.next_attempt_at IS NOT NULL AND now() >= _row.next_attempt_at THEN
      UPDATE public.api_circuit_state SET state = 'HALF_OPEN', updated_at = now() WHERE service = _service;
      RETURN jsonb_build_object('allow', true, 'state', 'HALF_OPEN');
    END IF;
    RETURN jsonb_build_object('allow', false, 'state', 'OPEN',
      'retry_after', EXTRACT(EPOCH FROM (_row.next_attempt_at - now())));
  END IF;
  RETURN jsonb_build_object('allow', true, 'state', _row.state);
END; $$;

CREATE OR REPLACE FUNCTION public.cb_record_success(_service text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.api_circuit_state
     SET state = 'CLOSED', failure_count = 0, opened_at = NULL,
         next_attempt_at = NULL, last_error = NULL, updated_at = now()
   WHERE service = _service;
END; $$;

CREATE OR REPLACE FUNCTION public.cb_record_failure(_service text, _error text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _row public.api_circuit_state%ROWTYPE; _new_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('cb:' || _service, 0));
  SELECT * INTO _row FROM public.api_circuit_state WHERE service = _service;
  IF NOT FOUND THEN
    INSERT INTO public.api_circuit_state (service, failure_count, last_error)
      VALUES (_service, 1, _error) RETURNING * INTO _row;
    RETURN jsonb_build_object('state', 'CLOSED', 'failures', 1);
  END IF;
  _new_count := _row.failure_count + 1;
  IF _new_count >= 3 OR _row.state = 'HALF_OPEN' THEN
    UPDATE public.api_circuit_state
       SET state = 'OPEN', failure_count = _new_count, opened_at = now(),
           next_attempt_at = now() + interval '2 minutes',
           last_error = _error, updated_at = now()
     WHERE service = _service;
    RETURN jsonb_build_object('state', 'OPEN', 'failures', _new_count);
  END IF;
  UPDATE public.api_circuit_state
     SET failure_count = _new_count, last_error = _error, updated_at = now()
   WHERE service = _service;
  RETURN jsonb_build_object('state', _row.state, 'failures', _new_count);
END; $$;

REVOKE EXECUTE ON FUNCTION public.cb_check(text)               FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_record_success(text)      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_record_failure(text,text) FROM PUBLIC, anon, authenticated;

-- 5) API usage daily
CREATE TABLE IF NOT EXISTS public.api_usage_daily (
  service     text NOT NULL,
  day         date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  call_count  integer NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (service, day)
);
ALTER TABLE public.api_usage_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read api usage" ON public.api_usage_daily;
CREATE POLICY "Admins read api usage" ON public.api_usage_daily
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.api_usage_increment(_service text, _max_per_day integer, _amount integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _today date := (now() AT TIME ZONE 'UTC')::date; _count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('quota:' || _service || ':' || _today::text, 0));
  INSERT INTO public.api_usage_daily (service, day, call_count, updated_at)
       VALUES (_service, _today, 0, now())
  ON CONFLICT (service, day) DO NOTHING;
  SELECT call_count INTO _count FROM public.api_usage_daily WHERE service = _service AND day = _today;
  IF _count + _amount > _max_per_day THEN
    RETURN jsonb_build_object('allow', false, 'count', _count, 'limit', _max_per_day);
  END IF;
  UPDATE public.api_usage_daily SET call_count = call_count + _amount, updated_at = now()
   WHERE service = _service AND day = _today RETURNING call_count INTO _count;
  RETURN jsonb_build_object('allow', true, 'count', _count, 'limit', _max_per_day);
END; $$;

REVOKE EXECUTE ON FUNCTION public.api_usage_increment(text,integer,integer) FROM PUBLIC, anon, authenticated;
