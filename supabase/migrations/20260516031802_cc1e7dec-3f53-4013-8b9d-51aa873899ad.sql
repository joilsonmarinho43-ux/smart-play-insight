
-- Garantir extensões
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ════════════════════════════════════════
-- 1. Limpeza automática de outbox dead > 7 dias
-- ════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.cleanup_old_dead_outbox()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _deleted integer;
BEGIN
  DELETE FROM public.telegram_outbox
   WHERE status IN ('dead', 'delivered')
     AND updated_at < now() - interval '7 days';
  GET DIAGNOSTICS _deleted = ROW_COUNT;
  RETURN _deleted;
END;
$$;

-- ════════════════════════════════════════
-- 2. Monitor operacional + alertas
-- ════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.ops_health_monitor()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _pending int;
  _last_signal timestamptz;
  _cb_open int;
  _cache_total int;
  _cache_stale int;
  _stale_ratio numeric;
  _tg_total int;
  _tg_failed int;
  _failure_ratio numeric;
  _hour_brt int;
  _alerts jsonb := '[]'::jsonb;
  _chat_id text;
BEGIN
  -- janela ativa: 10h-23h Brasília (UTC-3)
  _hour_brt := EXTRACT(HOUR FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::int;

  -- 1) Outbox pending alto
  SELECT count(*) INTO _pending FROM public.telegram_outbox WHERE status = 'pending';
  IF _pending > 10 AND public.alert_should_fire('outbox_pending_high', 30) THEN
    _alerts := _alerts || jsonb_build_object('type', 'outbox_pending', 'value', _pending);
  END IF;

  -- 2) Ausência de sinais > 6h em janela ativa
  IF _hour_brt BETWEEN 10 AND 23 THEN
    SELECT max(created_at) INTO _last_signal
      FROM public.telegram_signals WHERE success = true;
    IF _last_signal IS NULL OR _last_signal < now() - interval '6 hours' THEN
      IF public.alert_should_fire('no_signals_6h', 60) THEN
        _alerts := _alerts || jsonb_build_object(
          'type', 'no_signals',
          'last', COALESCE(_last_signal::text, 'never')
        );
      END IF;
    END IF;
  END IF;

  -- 3) Circuit breaker aberto
  SELECT count(*) INTO _cb_open FROM public.api_circuit_state WHERE state = 'OPEN';
  IF _cb_open > 0 AND public.alert_should_fire('circuit_open', 30) THEN
    _alerts := _alerts || jsonb_build_object('type', 'circuit_open', 'count', _cb_open);
  END IF;

  -- 4) Cache zumbi (>90% stale e total >100)
  SELECT count(*), count(*) FILTER (WHERE ultima_atualizacao < now() - interval '48 hours')
    INTO _cache_total, _cache_stale FROM public.cache_api;
  IF _cache_total > 100 THEN
    _stale_ratio := _cache_stale::numeric / _cache_total::numeric;
    IF _stale_ratio > 0.90 AND public.alert_should_fire('cache_stale_high', 360) THEN
      _alerts := _alerts || jsonb_build_object(
        'type', 'cache_stale', 'ratio', round(_stale_ratio * 100, 1), 'total', _cache_total
      );
    END IF;
  END IF;

  -- 5) Falhas Telegram > 50% em 30 min (mín 5 tentativas)
  SELECT count(*), count(*) FILTER (WHERE success = false)
    INTO _tg_total, _tg_failed
    FROM public.telegram_signals
   WHERE created_at > now() - interval '30 minutes';
  IF _tg_total >= 5 THEN
    _failure_ratio := _tg_failed::numeric / _tg_total::numeric;
    IF _failure_ratio > 0.5 AND public.alert_should_fire('telegram_failure_high', 30) THEN
      _alerts := _alerts || jsonb_build_object(
        'type', 'telegram_failures',
        'failed', _tg_failed, 'total', _tg_total
      );
    END IF;
  END IF;

  -- Enviar alertas via outbox (se houver chat configurado em telegram_alert_state)
  IF jsonb_array_length(_alerts) > 0 THEN
    SELECT (last_payload->>'chat_id') INTO _chat_id
      FROM public.telegram_alert_state
     WHERE alert_key = '__ops_monitor_config'
     LIMIT 1;

    IF _chat_id IS NOT NULL THEN
      INSERT INTO public.telegram_outbox (chat_id, text, source, status, next_retry_at)
      VALUES (
        _chat_id,
        '🚨 <b>OPS MONITOR</b>' || E'\n' || _alerts::text,
        'ops-monitor',
        'pending',
        now()
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'checked_at', now(),
    'pending', _pending,
    'cache_stale_ratio', COALESCE(_stale_ratio, 0),
    'cb_open', _cb_open,
    'tg_failure_ratio', COALESCE(_failure_ratio, 0),
    'alerts', _alerts
  );
END;
$$;

-- ════════════════════════════════════════
-- 3. Agendamento dos crons (idempotente)
-- ════════════════════════════════════════
DO $$
BEGIN
  -- limpa jobs antigos (recriação idempotente)
  PERFORM cron.unschedule(jobname) FROM cron.job
   WHERE jobname IN (
     'ops-cleanup-cache-api-6h',
     'ops-cleanup-rate-limits-daily',
     'ops-cleanup-dead-outbox-daily',
     'ops-health-monitor-10min'
   );

  -- cleanup_cache_api a cada 6h
  PERFORM cron.schedule(
    'ops-cleanup-cache-api-6h',
    '15 */6 * * *',
    $cmd$ SELECT public.cleanup_cache_api(); $cmd$
  );

  -- cleanup_rate_limits 1x/dia (03:00 UTC = 00:00 BRT)
  PERFORM cron.schedule(
    'ops-cleanup-rate-limits-daily',
    '0 3 * * *',
    $cmd$ SELECT public.cleanup_rate_limits(); $cmd$
  );

  -- cleanup_old_dead_outbox 1x/dia (03:10 UTC)
  PERFORM cron.schedule(
    'ops-cleanup-dead-outbox-daily',
    '10 3 * * *',
    $cmd$ SELECT public.cleanup_old_dead_outbox(); $cmd$
  );

  -- monitor a cada 10 min
  PERFORM cron.schedule(
    'ops-health-monitor-10min',
    '*/10 * * * *',
    $cmd$ SELECT public.ops_health_monitor(); $cmd$
  );
END $$;

-- ════════════════════════════════════════
-- 4. Seed do chat de alertas (usa TELEGRAM_CHAT_ID já configurado via outbox)
-- ════════════════════════════════════════
-- Operador pode rodar manualmente:
-- INSERT INTO telegram_alert_state (alert_key, last_payload)
-- VALUES ('__ops_monitor_config', jsonb_build_object('chat_id', 'SEU_CHAT_ID'))
-- ON CONFLICT (alert_key) DO UPDATE SET last_payload = EXCLUDED.last_payload;
