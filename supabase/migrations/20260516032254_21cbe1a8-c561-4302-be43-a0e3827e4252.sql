
-- ════════════════════════════════════════
-- 1. Colunas novas em telegram_signals
-- ════════════════════════════════════════
ALTER TABLE public.telegram_signals
  ADD COLUMN IF NOT EXISTS league text,
  ADD COLUMN IF NOT EXISTS quality_score numeric,
  ADD COLUMN IF NOT EXISTS quality_breakdown jsonb;

CREATE INDEX IF NOT EXISTS idx_tg_signals_created_result
  ON public.telegram_signals (created_at DESC) WHERE success = true;

CREATE INDEX IF NOT EXISTS idx_tg_signals_market_result
  ON public.telegram_signals (market, result) WHERE result IS NOT NULL;

-- ════════════════════════════════════════
-- 2. Tabela de sugestões automáticas
-- ════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.signal_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,           -- 'market' | 'strategy' | 'hour' | 'league' | 'minute_window'
  subject text NOT NULL,            -- ex: 'Over 1.5'
  severity text NOT NULL DEFAULT 'info',  -- 'info' | 'warning' | 'critical'
  metric text NOT NULL,             -- 'winrate_drop' | 'roi_negative' | 'streak_loss'
  message text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open',    -- 'open' | 'acknowledged' | 'resolved'
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_signal_suggestions_status
  ON public.signal_suggestions (status, created_at DESC);

ALTER TABLE public.signal_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read signal suggestions" ON public.signal_suggestions;
CREATE POLICY "Admins read signal suggestions"
  ON public.signal_suggestions FOR SELECT
  TO authenticated
  USING (is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins update signal suggestions" ON public.signal_suggestions;
CREATE POLICY "Admins update signal suggestions"
  ON public.signal_suggestions FOR UPDATE
  TO authenticated
  USING (is_admin(auth.uid()));

-- ════════════════════════════════════════
-- 3. Função: analytics agregadas
-- ════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_signal_analytics(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _result jsonb;
  _since timestamptz := now() - make_interval(days => p_days);
BEGIN
  IF NOT is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  WITH base AS (
    SELECT *
      FROM telegram_signals
     WHERE created_at >= _since
       AND success = true
  ),
  resolved AS (
    SELECT * FROM base WHERE result IN ('WIN','LOSS','VOID','GREEN','RED')
  ),
  overall AS (
    SELECT
      count(*)                                              AS total,
      count(*) FILTER (WHERE result IN ('WIN','GREEN'))     AS wins,
      count(*) FILTER (WHERE result IN ('LOSS','RED'))      AS losses,
      count(*) FILTER (WHERE result = 'VOID')               AS voids,
      ROUND(AVG(confidence)::numeric, 1)                    AS avg_confidence,
      ROUND(AVG(roi)::numeric, 3)                           AS avg_roi,
      ROUND(SUM(roi)::numeric, 2)                           AS total_roi
    FROM resolved
  ),
  by_market AS (
    SELECT market AS subject,
           count(*) AS total,
           count(*) FILTER (WHERE result IN ('WIN','GREEN')) AS wins,
           ROUND(AVG(roi)::numeric, 3) AS avg_roi
      FROM resolved
     GROUP BY market
     ORDER BY total DESC
  ),
  by_strategy AS (
    SELECT COALESCE(sensitivity,'?') AS subject,
           count(*) AS total,
           count(*) FILTER (WHERE result IN ('WIN','GREEN')) AS wins,
           ROUND(AVG(roi)::numeric, 3) AS avg_roi
      FROM resolved
     GROUP BY sensitivity
     ORDER BY total DESC
  ),
  by_hour AS (
    SELECT EXTRACT(HOUR FROM (created_at AT TIME ZONE 'America/Sao_Paulo'))::int AS hour_brt,
           count(*) AS total,
           count(*) FILTER (WHERE result IN ('WIN','GREEN')) AS wins,
           ROUND(AVG(roi)::numeric, 3) AS avg_roi
      FROM resolved
     GROUP BY 1
     ORDER BY 1
  ),
  by_minute_window AS (
    SELECT CASE
             WHEN minute < 15 THEN '0-14'
             WHEN minute < 30 THEN '15-29'
             WHEN minute < 45 THEN '30-44'
             WHEN minute < 60 THEN '45-59'
             WHEN minute < 75 THEN '60-74'
             ELSE '75+'
           END AS subject,
           count(*) AS total,
           count(*) FILTER (WHERE result IN ('WIN','GREEN')) AS wins,
           ROUND(AVG(roi)::numeric, 3) AS avg_roi
      FROM resolved
     GROUP BY 1
     ORDER BY 1
  ),
  by_league AS (
    SELECT COALESCE(league,'?') AS subject,
           count(*) AS total,
           count(*) FILTER (WHERE result IN ('WIN','GREEN')) AS wins,
           ROUND(AVG(roi)::numeric, 3) AS avg_roi
      FROM resolved
     WHERE league IS NOT NULL
     GROUP BY league
     HAVING count(*) >= 3
     ORDER BY 2 DESC
     LIMIT 20
  ),
  daily AS (
    SELECT (created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
           count(*) AS total,
           count(*) FILTER (WHERE result IN ('WIN','GREEN')) AS wins,
           ROUND(AVG(roi)::numeric, 3) AS avg_roi
      FROM resolved
     GROUP BY 1
     ORDER BY 1 DESC
     LIMIT 60
  ),
  streak AS (
    SELECT array_agg(result ORDER BY created_at DESC) FILTER (WHERE result IS NOT NULL) AS recent
      FROM (SELECT result, created_at FROM resolved ORDER BY created_at DESC LIMIT 20) s
  )
  SELECT jsonb_build_object(
    'window_days', p_days,
    'generated_at', now(),
    'overall', (SELECT to_jsonb(o.*) FROM overall o),
    'by_market', COALESCE((SELECT jsonb_agg(to_jsonb(m.*)) FROM by_market m), '[]'),
    'by_strategy', COALESCE((SELECT jsonb_agg(to_jsonb(s.*)) FROM by_strategy s), '[]'),
    'by_hour', COALESCE((SELECT jsonb_agg(to_jsonb(h.*)) FROM by_hour h), '[]'),
    'by_minute_window', COALESCE((SELECT jsonb_agg(to_jsonb(w.*)) FROM by_minute_window w), '[]'),
    'by_league', COALESCE((SELECT jsonb_agg(to_jsonb(l.*)) FROM by_league l), '[]'),
    'daily', COALESCE((SELECT jsonb_agg(to_jsonb(d.*)) FROM daily d), '[]'),
    'recent_results', COALESCE((SELECT recent FROM streak), ARRAY[]::text[])
  ) INTO _result;

  RETURN _result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_signal_analytics(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_signal_analytics(integer) TO authenticated;

-- ════════════════════════════════════════
-- 4. Detecção de degradação (somente sugestões)
-- ════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.detect_signal_degradation()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r record;
  _winrate_recent numeric;
  _winrate_prior numeric;
  _roi_recent numeric;
  _inserted int := 0;
BEGIN
  -- Por mercado: recent (últimos 7d) vs prior (8-37d)
  FOR r IN
    SELECT market,
           count(*) FILTER (
             WHERE created_at >= now() - interval '7 days'
               AND result IN ('WIN','LOSS','GREEN','RED')
           ) AS recent_total,
           count(*) FILTER (
             WHERE created_at >= now() - interval '7 days'
               AND result IN ('WIN','GREEN')
           ) AS recent_wins,
           count(*) FILTER (
             WHERE created_at <  now() - interval '7 days'
               AND created_at >= now() - interval '37 days'
               AND result IN ('WIN','LOSS','GREEN','RED')
           ) AS prior_total,
           count(*) FILTER (
             WHERE created_at <  now() - interval '7 days'
               AND created_at >= now() - interval '37 days'
               AND result IN ('WIN','GREEN')
           ) AS prior_wins,
           AVG(roi) FILTER (
             WHERE created_at >= now() - interval '7 days'
               AND result IN ('WIN','LOSS','GREEN','RED')
           ) AS recent_roi
      FROM telegram_signals
     WHERE success = true
     GROUP BY market
  LOOP
    IF r.recent_total < 10 OR r.prior_total < 10 THEN CONTINUE; END IF;
    _winrate_recent := r.recent_wins::numeric / r.recent_total;
    _winrate_prior  := r.prior_wins::numeric / r.prior_total;
    _roi_recent     := COALESCE(r.recent_roi, 0);

    -- Winrate caiu mais de 15pp
    IF (_winrate_prior - _winrate_recent) > 0.15 THEN
      INSERT INTO signal_suggestions (category, subject, severity, metric, message, payload)
      VALUES ('market', r.market, 'warning', 'winrate_drop',
              format('Winrate de "%s" caiu de %s%% para %s%% nos últimos 7 dias',
                     r.market,
                     ROUND(_winrate_prior*100, 1),
                     ROUND(_winrate_recent*100, 1)),
              jsonb_build_object(
                'recent_wr', ROUND(_winrate_recent*100, 1),
                'prior_wr',  ROUND(_winrate_prior*100, 1),
                'recent_total', r.recent_total,
                'prior_total',  r.prior_total
              ));
      _inserted := _inserted + 1;
    END IF;

    -- ROI negativo persistente (sample ≥ 20)
    IF r.recent_total >= 20 AND _roi_recent < -0.05 THEN
      INSERT INTO signal_suggestions (category, subject, severity, metric, message, payload)
      VALUES ('market', r.market, 'critical', 'roi_negative',
              format('ROI de "%s" está em %s nos últimos 7 dias (%s sinais)',
                     r.market, ROUND(_roi_recent, 3), r.recent_total),
              jsonb_build_object('roi', _roi_recent, 'total', r.recent_total));
      _inserted := _inserted + 1;
    END IF;
  END LOOP;

  -- Por estratégia (sensitivity)
  FOR r IN
    SELECT COALESCE(sensitivity,'?') AS strat,
           count(*) FILTER (
             WHERE created_at >= now() - interval '7 days'
               AND result IN ('WIN','LOSS','GREEN','RED')
           ) AS recent_total,
           count(*) FILTER (
             WHERE created_at >= now() - interval '7 days'
               AND result IN ('WIN','GREEN')
           ) AS recent_wins,
           count(*) FILTER (
             WHERE created_at <  now() - interval '7 days'
               AND created_at >= now() - interval '37 days'
               AND result IN ('WIN','LOSS','GREEN','RED')
           ) AS prior_total,
           count(*) FILTER (
             WHERE created_at <  now() - interval '7 days'
               AND created_at >= now() - interval '37 days'
               AND result IN ('WIN','GREEN')
           ) AS prior_wins
      FROM telegram_signals
     WHERE success = true
     GROUP BY sensitivity
  LOOP
    IF r.recent_total < 10 OR r.prior_total < 10 THEN CONTINUE; END IF;
    _winrate_recent := r.recent_wins::numeric / r.recent_total;
    _winrate_prior  := r.prior_wins::numeric / r.prior_total;
    IF (_winrate_prior - _winrate_recent) > 0.15 THEN
      INSERT INTO signal_suggestions (category, subject, severity, metric, message, payload)
      VALUES ('strategy', r.strat, 'warning', 'winrate_drop',
              format('Estratégia "%s" caiu de %s%% para %s%% nos últimos 7 dias',
                     r.strat,
                     ROUND(_winrate_prior*100, 1),
                     ROUND(_winrate_recent*100, 1)),
              jsonb_build_object(
                'recent_wr', ROUND(_winrate_recent*100, 1),
                'prior_wr',  ROUND(_winrate_prior*100, 1)
              ));
      _inserted := _inserted + 1;
    END IF;
  END LOOP;

  RETURN _inserted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.detect_signal_degradation() FROM PUBLIC, anon, authenticated;

-- ════════════════════════════════════════
-- 5. Cron diário 04:00 UTC
-- ════════════════════════════════════════
DO $$
BEGIN
  PERFORM cron.unschedule(jobname) FROM cron.job
   WHERE jobname = 'ops-detect-degradation-daily';

  PERFORM cron.schedule(
    'ops-detect-degradation-daily',
    '0 4 * * *',
    $cmd$ SELECT public.detect_signal_degradation(); $cmd$
  );
END $$;
