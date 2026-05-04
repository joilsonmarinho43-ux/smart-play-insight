-- Garantir extensões necessárias
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Função dedicada de cleanup agressivo do cache live
CREATE OR REPLACE FUNCTION public.cleanup_live_cache()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Remove apenas estatísticas live órfãs com mais de 2 horas
  -- Não toca em: live_all, date_*, league_recent_*, finished_*
  DELETE FROM public.cache_api
  WHERE cache_key LIKE 'live_fstats_%'
    AND ultima_atualizacao < now() - interval '2 hours';

  -- Remove também live_all stale (>15 minutos é zumbi, jogos ao vivo mudam rápido)
  DELETE FROM public.cache_api
  WHERE cache_key = 'live_all'
    AND ultima_atualizacao < now() - interval '15 minutes';
END;
$function$;

-- Atualizar cleanup diário para incluir também live_fstats_* zumbis (defesa em profundidade)
CREATE OR REPLACE FUNCTION public.cleanup_cache_api()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Live stats órfãs: >2h
  DELETE FROM public.cache_api
  WHERE cache_key LIKE 'live_fstats_%'
    AND ultima_atualizacao < now() - interval '2 hours';

  -- LIVE genérico: >24h
  DELETE FROM public.cache_api
  WHERE status_jogo = 'LIVE'
    AND ultima_atualizacao < now() - interval '24 hours';

  -- PRE: >48h
  DELETE FROM public.cache_api
  WHERE status_jogo = 'PRE'
    AND ultima_atualizacao < now() - interval '48 hours';

  -- STATS: >7 dias (FINISHED preservado)
  DELETE FROM public.cache_api
  WHERE status_jogo = 'STATS'
    AND ultima_atualizacao < now() - interval '7 days';
END;
$function$;

-- Remover job antigo se existir (idempotente)
DO $$
BEGIN
  PERFORM cron.unschedule('cleanup-live-cache-30min');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Agendar cleanup live a cada 30 minutos
SELECT cron.schedule(
  'cleanup-live-cache-30min',
  '*/30 * * * *',
  $$ SELECT public.cleanup_live_cache(); $$
);