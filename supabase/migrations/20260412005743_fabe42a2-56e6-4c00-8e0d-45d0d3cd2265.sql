-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Create cleanup function
CREATE OR REPLACE FUNCTION public.cleanup_cache_api()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Remove LIVE entries older than 24h
  DELETE FROM public.cache_api
  WHERE status_jogo = 'LIVE'
    AND ultima_atualizacao < now() - interval '24 hours';

  -- Remove PRE entries older than 48h
  DELETE FROM public.cache_api
  WHERE status_jogo = 'PRE'
    AND ultima_atualizacao < now() - interval '48 hours';

  -- Remove STATS entries older than 7 days (keep FINISHED forever)
  DELETE FROM public.cache_api
  WHERE status_jogo = 'STATS'
    AND ultima_atualizacao < now() - interval '7 days';
END;
$$;

-- Schedule daily cleanup at 3:00 AM UTC
SELECT cron.schedule(
  'cleanup-cache-api-daily',
  '0 3 * * *',
  $$SELECT public.cleanup_cache_api()$$
);