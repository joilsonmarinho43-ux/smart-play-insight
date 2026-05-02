-- ═══════════════════════════════════════════════════════════════
-- 1) IDEMPOTÊNCIA ATÔMICA — telegram_signals
-- ═══════════════════════════════════════════════════════════════

-- UNIQUE INDEX parcial: apenas sinais bem-sucedidos contam para dedupe.
-- Permite reenvio se a tentativa anterior falhou.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_telegram_signal_success
  ON public.telegram_signals (match_id, market, minute)
  WHERE success = true AND match_id IS NOT NULL;

-- Função para inserir sinal de forma atômica.
-- Retorna o id se inseriu, NULL se já existia (dedupe).
-- O caller deve usar o retorno para decidir se envia ao Telegram.
CREATE OR REPLACE FUNCTION public.try_claim_telegram_slot(
  _match_id text,
  _match_name text,
  _market text,
  _minute int,
  _confidence int,
  _filters_validated text,
  _sensitivity text,
  _score text,
  _poisson text,
  _odd_min text,
  _janela text,
  _reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id uuid;
BEGIN
  -- Insert "tentative" success row. If conflict (duplicate), returns NULL.
  -- Caller atualizará success/error_message/telegram_message_id depois.
  INSERT INTO public.telegram_signals (
    match_id, match_name, market, minute, confidence,
    filters_validated, sensitivity, score, poisson, odd_min, janela, reason,
    success, status
  ) VALUES (
    _match_id, _match_name, _market, _minute, _confidence,
    _filters_validated, _sensitivity, _score, _poisson, _odd_min, _janela, _reason,
    true, 'pendente'
  )
  ON CONFLICT (match_id, market, minute) WHERE success = true AND match_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;

-- Função para registrar falha quando matchId não permite dedupe atômico,
-- ou quando o envio ao Telegram falha após o claim.
CREATE OR REPLACE FUNCTION public.mark_telegram_signal_failed(
  _signal_id uuid,
  _error text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Marca como failed: libera o slot (success=false não bloqueia o índice parcial)
  UPDATE public.telegram_signals
  SET success = false,
      error_message = _error
  WHERE id = _signal_id;
END;
$$;

-- Função para preencher message_id após sucesso real do envio
CREATE OR REPLACE FUNCTION public.mark_telegram_signal_sent(
  _signal_id uuid,
  _message_id bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.telegram_signals
  SET telegram_message_id = _message_id,
      success = true,
      error_message = NULL
  WHERE id = _signal_id;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 2) MUTEX — pg_advisory_xact_lock para football-api
-- ═══════════════════════════════════════════════════════════════

-- Lock cooperativo por cache_key. A função roda em transação implícita
-- (uma chamada RPC = uma transação), então o lock é liberado ao retornar.
-- O caller deve invocar isto, depois ler o cache; se faltar, fazer fetch
-- e gravar; o próximo waiter encontrará o cache populado.
CREATE OR REPLACE FUNCTION public.acquire_cache_lock(_cache_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- bigint hash; lock automaticamente liberado no fim da transação.
  PERFORM pg_advisory_xact_lock(hashtextextended(_cache_key, 0));
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 3) RATE LIMIT — register-session
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket text NOT NULL,                       -- ex: 'register-session'
  subject text NOT NULL,                      -- ex: user_id::text ou ip
  window_start timestamptz NOT NULL DEFAULT now(),
  count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_rate_limit_bucket_subject
  ON public.rate_limits (bucket, subject);

CREATE INDEX IF NOT EXISTS idx_rate_limits_window
  ON public.rate_limits (window_start);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read rate limits" ON public.rate_limits;
CREATE POLICY "Admins read rate limits"
  ON public.rate_limits
  FOR SELECT
  TO authenticated
  USING (is_admin(auth.uid()));

-- check_rate_limit: rolling window (em segundos), max calls por janela.
-- Retorna true se PERMITIDO, false se BLOQUEADO.
-- Atômico via UPSERT + advisory lock no par (bucket, subject).
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  _bucket text,
  _subject text,
  _max_calls int,
  _window_seconds int
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.rate_limits%ROWTYPE;
  _now timestamptz := now();
  _window_start timestamptz := _now - make_interval(secs => _window_seconds);
BEGIN
  -- Lock pontual evita corrida no UPSERT/UPDATE
  PERFORM pg_advisory_xact_lock(hashtextextended('rl:' || _bucket || ':' || _subject, 0));

  SELECT * INTO _row FROM public.rate_limits
   WHERE bucket = _bucket AND subject = _subject;

  IF NOT FOUND THEN
    INSERT INTO public.rate_limits (bucket, subject, window_start, count, updated_at)
    VALUES (_bucket, _subject, _now, 1, _now);
    RETURN true;
  END IF;

  -- Janela expirou → reset
  IF _row.window_start < _window_start THEN
    UPDATE public.rate_limits
       SET window_start = _now, count = 1, updated_at = _now
     WHERE bucket = _bucket AND subject = _subject;
    RETURN true;
  END IF;

  -- Dentro da janela
  IF _row.count >= _max_calls THEN
    RETURN false;
  END IF;

  UPDATE public.rate_limits
     SET count = count + 1, updated_at = _now
   WHERE bucket = _bucket AND subject = _subject;
  RETURN true;
END;
$$;

-- Limpeza periódica de buckets antigos
CREATE OR REPLACE FUNCTION public.cleanup_rate_limits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.rate_limits
   WHERE updated_at < now() - interval '1 day';
END;
$$;