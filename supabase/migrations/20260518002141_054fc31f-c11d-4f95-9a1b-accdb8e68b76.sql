
-- =========================================================
-- FIX: WR sempre 0% — normaliza result (case-insensitive)
-- =========================================================

-- Helper: normaliza nome de mercado para agrupar duplicatas
CREATE OR REPLACE FUNCTION public.normalize_market(_m text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _m IS NULL THEN NULL
    ELSE
      regexp_replace(
        regexp_replace(
          lower(trim(_m)),
          '\s+(gols?|goals?|cartoes|cart[õo]es|cards?|escanteios?|corners?)\s*$',
          '', 'i'
        ),
        '\s+', ' ', 'g'
      )
  END;
$$;

-- Backfill: copia result do telegram_signals para signal_tracking quando faltante
UPDATE public.signal_tracking st
   SET result = ts.result,
       finalized = true,
       finalized_at = COALESCE(st.finalized_at, ts.settled_at, now())
  FROM public.telegram_signals ts
 WHERE st.signal_id = ts.id
   AND ts.result IS NOT NULL
   AND (st.result IS NULL OR st.result = '');

-- =========================================================
-- get_signal_analytics — case-insensitive + cast numeric
-- =========================================================
CREATE OR REPLACE FUNCTION public.get_signal_analytics(p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _result jsonb;
  _since timestamptz := now() - make_interval(days => p_days);
BEGIN
  IF NOT is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  WITH base AS (
    SELECT *,
           upper(coalesce(result,'')) AS r_norm,
           public.normalize_market(market) AS market_norm
      FROM telegram_signals
     WHERE created_at >= _since
       AND success = true
  ),
  resolved AS (
    SELECT * FROM base WHERE r_norm IN ('WIN','LOSS','VOID','GREEN','RED')
  ),
  overall AS (
    SELECT
      count(*)                                              AS total,
      count(*) FILTER (WHERE r_norm IN ('WIN','GREEN'))     AS wins,
      count(*) FILTER (WHERE r_norm IN ('LOSS','RED'))      AS losses,
      count(*) FILTER (WHERE r_norm = 'VOID')               AS voids,
      ROUND(AVG(confidence)::numeric, 1)                    AS avg_confidence,
      ROUND(AVG(roi)::numeric, 3)                           AS avg_roi,
      ROUND(SUM(roi)::numeric, 2)                           AS total_roi,
      CASE WHEN count(*) FILTER (WHERE r_norm IN ('WIN','LOSS','GREEN','RED')) > 0
           THEN ROUND(
             (count(*) FILTER (WHERE r_norm IN ('WIN','GREEN'))::numeric * 100.0) /
              count(*) FILTER (WHERE r_norm IN ('WIN','LOSS','GREEN','RED'))::numeric,
             1)
           ELSE 0 END AS winrate
    FROM resolved
  ),
  by_market AS (
    SELECT market_norm AS subject,
           count(*) AS total,
           count(*) FILTER (WHERE r_norm IN ('WIN','GREEN')) AS wins,
           ROUND(AVG(roi)::numeric, 3) AS avg_roi
      FROM resolved
     GROUP BY market_norm
     ORDER BY total DESC
  ),
  by_strategy AS (
    SELECT COALESCE(sensitivity,'?') AS subject,
           count(*) AS total,
           count(*) FILTER (WHERE r_norm IN ('WIN','GREEN')) AS wins,
           ROUND(AVG(roi)::numeric, 3) AS avg_roi
      FROM resolved
     GROUP BY sensitivity
     ORDER BY total DESC
  ),
  by_hour AS (
    SELECT EXTRACT(HOUR FROM (created_at AT TIME ZONE 'America/Sao_Paulo'))::int AS hour_brt,
           count(*) AS total,
           count(*) FILTER (WHERE r_norm IN ('WIN','GREEN')) AS wins,
           ROUND(AVG(roi)::numeric, 3) AS avg_roi
      FROM resolved
     GROUP BY 1 ORDER BY 1
  ),
  by_minute_window AS (
    SELECT CASE
             WHEN minute < 15 THEN '0-14'
             WHEN minute < 30 THEN '15-29'
             WHEN minute < 45 THEN '30-44'
             WHEN minute < 60 THEN '45-59'
             WHEN minute < 75 THEN '60-74'
             ELSE '75+' END AS subject,
           count(*) AS total,
           count(*) FILTER (WHERE r_norm IN ('WIN','GREEN')) AS wins,
           ROUND(AVG(roi)::numeric, 3) AS avg_roi
      FROM resolved
     GROUP BY 1 ORDER BY 1
  ),
  by_league AS (
    SELECT COALESCE(league,'?') AS subject,
           count(*) AS total,
           count(*) FILTER (WHERE r_norm IN ('WIN','GREEN')) AS wins,
           ROUND(AVG(roi)::numeric, 3) AS avg_roi
      FROM resolved
     WHERE league IS NOT NULL
     GROUP BY league
     HAVING count(*) >= 3
     ORDER BY 2 DESC LIMIT 20
  ),
  daily AS (
    SELECT (created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
           count(*) AS total,
           count(*) FILTER (WHERE r_norm IN ('WIN','GREEN')) AS wins,
           ROUND(AVG(roi)::numeric, 3) AS avg_roi
      FROM resolved
     GROUP BY 1 ORDER BY 1 DESC LIMIT 60
  ),
  streak AS (
    SELECT array_agg(upper(result) ORDER BY created_at DESC)
             FILTER (WHERE result IS NOT NULL) AS recent
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
$function$;

-- =========================================================
-- get_signal_context_analytics — idem
-- =========================================================
CREATE OR REPLACE FUNCTION public.get_signal_context_analytics(p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _result jsonb;
  _since timestamptz := now() - make_interval(days => p_days);
BEGIN
  IF NOT is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  WITH base AS (
    SELECT *,
           upper(coalesce(result,'')) AS r_norm,
           public.normalize_market(market) AS market_norm
      FROM signal_tracking
     WHERE entry_at >= _since AND finalized = true
  ),
  overall AS (
    SELECT
      count(*) AS total,
      ROUND(AVG(time_to_goal_sec)/60.0, 1)        AS avg_time_to_goal_min,
      ROUND(AVG(entry_pressure)::numeric, 1)      AS avg_entry_pressure,
      ROUND(AVG(avg_pressure)::numeric, 1)        AS avg_sustained_pressure,
      ROUND(AVG(pressure_drop_pct)::numeric, 3)   AS avg_pressure_drop,
      ROUND(AVG(snapshot_count)::numeric, 1)      AS avg_snapshots,
      count(*) FILTER (WHERE r_norm IN ('WIN','GREEN')) AS wins,
      count(*) FILTER (WHERE r_norm IN ('WIN','LOSS','GREEN','RED')) AS resolved
    FROM base
  ),
  by_behavior AS (
    SELECT COALESCE(behavior_class,'desconhecido') AS subject,
           count(*) AS total,
           count(*) FILTER (WHERE r_norm IN ('WIN','GREEN')) AS wins,
           ROUND(AVG(time_to_goal_sec)/60.0, 1) AS avg_time_min,
           ROUND(AVG(avg_pressure)::numeric, 1) AS avg_pressure
    FROM base GROUP BY 1 ORDER BY 2 DESC
  ),
  by_entry_window AS (
    SELECT CASE
      WHEN entry_minute < 15 THEN '0-14'
      WHEN entry_minute < 30 THEN '15-29'
      WHEN entry_minute < 45 THEN '30-44'
      WHEN entry_minute < 60 THEN '45-59'
      WHEN entry_minute < 75 THEN '60-74'
      ELSE '75+'
    END AS subject,
    count(*) AS total,
    count(*) FILTER (WHERE r_norm IN ('WIN','GREEN')) AS wins,
    ROUND(AVG(time_to_goal_sec)/60.0, 1) AS avg_time_min,
    ROUND(AVG(pressure_drop_pct)::numeric, 3) AS avg_drop
    FROM base GROUP BY 1 ORDER BY 1
  ),
  by_league AS (
    SELECT COALESCE(league,'?') AS subject,
           count(*) AS total,
           count(*) FILTER (WHERE r_norm IN ('WIN','GREEN')) AS wins,
           count(*) FILTER (WHERE behavior_class = 'fake_pressure') AS fakes,
           count(*) FILTER (WHERE behavior_class = 'dead_after_entry') AS deaths,
           ROUND(AVG(avg_pressure)::numeric, 1) AS avg_pressure,
           ROUND(AVG(pressure_drop_pct)::numeric, 3) AS avg_drop
    FROM base
    WHERE league IS NOT NULL
    GROUP BY league HAVING count(*) >= 3
    ORDER BY 2 DESC LIMIT 20
  ),
  by_market AS (
    SELECT market_norm AS subject,
           count(*) AS total,
           count(*) FILTER (WHERE r_norm IN ('WIN','GREEN')) AS wins,
           ROUND(AVG(time_to_goal_sec)/60.0, 1) AS avg_time_min,
           ROUND(AVG(avg_pressure)::numeric, 1) AS avg_pressure
    FROM base GROUP BY 1 ORDER BY 2 DESC
  )
  SELECT jsonb_build_object(
    'window_days', p_days,
    'generated_at', now(),
    'overall', (SELECT to_jsonb(o.*) FROM overall o),
    'by_behavior',     COALESCE((SELECT jsonb_agg(to_jsonb(b.*)) FROM by_behavior b), '[]'),
    'by_entry_window', COALESCE((SELECT jsonb_agg(to_jsonb(w.*)) FROM by_entry_window w), '[]'),
    'by_league',       COALESCE((SELECT jsonb_agg(to_jsonb(l.*)) FROM by_league l), '[]'),
    'by_market',       COALESCE((SELECT jsonb_agg(to_jsonb(m.*)) FROM by_market m), '[]')
  ) INTO _result;

  RETURN _result;
END;
$function$;

-- =========================================================
-- detect_signal_degradation — idem (case-insensitive)
-- =========================================================
CREATE OR REPLACE FUNCTION public.detect_signal_degradation()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  _winrate_recent numeric;
  _winrate_prior numeric;
  _roi_recent numeric;
  _inserted int := 0;
BEGIN
  FOR r IN
    SELECT public.normalize_market(market) AS market,
           count(*) FILTER (WHERE created_at >= now() - interval '7 days'
             AND upper(coalesce(result,'')) IN ('WIN','LOSS','GREEN','RED')) AS recent_total,
           count(*) FILTER (WHERE created_at >= now() - interval '7 days'
             AND upper(coalesce(result,'')) IN ('WIN','GREEN')) AS recent_wins,
           count(*) FILTER (WHERE created_at <  now() - interval '7 days'
             AND created_at >= now() - interval '37 days'
             AND upper(coalesce(result,'')) IN ('WIN','LOSS','GREEN','RED')) AS prior_total,
           count(*) FILTER (WHERE created_at <  now() - interval '7 days'
             AND created_at >= now() - interval '37 days'
             AND upper(coalesce(result,'')) IN ('WIN','GREEN')) AS prior_wins,
           AVG(roi) FILTER (WHERE created_at >= now() - interval '7 days'
             AND upper(coalesce(result,'')) IN ('WIN','LOSS','GREEN','RED')) AS recent_roi
      FROM telegram_signals
     WHERE success = true
     GROUP BY public.normalize_market(market)
  LOOP
    IF r.recent_total < 10 OR r.prior_total < 10 THEN CONTINUE; END IF;
    _winrate_recent := r.recent_wins::numeric / r.recent_total::numeric;
    _winrate_prior  := r.prior_wins::numeric  / r.prior_total::numeric;
    _roi_recent     := COALESCE(r.recent_roi, 0);

    IF (_winrate_prior - _winrate_recent) > 0.15 THEN
      INSERT INTO signal_suggestions (category, subject, severity, metric, message, payload)
      VALUES ('market', r.market, 'warning', 'winrate_drop',
              format('Winrate de "%s" caiu de %s%% para %s%% nos últimos 7 dias',
                     r.market, ROUND(_winrate_prior*100, 1), ROUND(_winrate_recent*100, 1)),
              jsonb_build_object('recent_wr', ROUND(_winrate_recent*100, 1),
                                 'prior_wr',  ROUND(_winrate_prior*100, 1),
                                 'recent_total', r.recent_total,
                                 'prior_total',  r.prior_total));
      _inserted := _inserted + 1;
    END IF;

    IF r.recent_total >= 20 AND _roi_recent < -0.05 THEN
      INSERT INTO signal_suggestions (category, subject, severity, metric, message, payload)
      VALUES ('market', r.market, 'critical', 'roi_negative',
              format('ROI de "%s" está em %s nos últimos 7 dias (%s sinais)',
                     r.market, ROUND(_roi_recent, 3), r.recent_total),
              jsonb_build_object('roi', _roi_recent, 'total', r.recent_total));
      _inserted := _inserted + 1;
    END IF;
  END LOOP;

  FOR r IN
    SELECT COALESCE(sensitivity,'?') AS strat,
           count(*) FILTER (WHERE created_at >= now() - interval '7 days'
             AND upper(coalesce(result,'')) IN ('WIN','LOSS','GREEN','RED')) AS recent_total,
           count(*) FILTER (WHERE created_at >= now() - interval '7 days'
             AND upper(coalesce(result,'')) IN ('WIN','GREEN')) AS recent_wins,
           count(*) FILTER (WHERE created_at <  now() - interval '7 days'
             AND created_at >= now() - interval '37 days'
             AND upper(coalesce(result,'')) IN ('WIN','LOSS','GREEN','RED')) AS prior_total,
           count(*) FILTER (WHERE created_at <  now() - interval '7 days'
             AND created_at >= now() - interval '37 days'
             AND upper(coalesce(result,'')) IN ('WIN','GREEN')) AS prior_wins
      FROM telegram_signals
     WHERE success = true
     GROUP BY sensitivity
  LOOP
    IF r.recent_total < 10 OR r.prior_total < 10 THEN CONTINUE; END IF;
    _winrate_recent := r.recent_wins::numeric / r.recent_total::numeric;
    _winrate_prior  := r.prior_wins::numeric  / r.prior_total::numeric;
    IF (_winrate_prior - _winrate_recent) > 0.15 THEN
      INSERT INTO signal_suggestions (category, subject, severity, metric, message, payload)
      VALUES ('strategy', r.strat, 'warning', 'winrate_drop',
              format('Estratégia "%s" caiu de %s%% para %s%% nos últimos 7 dias',
                     r.strat, ROUND(_winrate_prior*100, 1), ROUND(_winrate_recent*100, 1)),
              jsonb_build_object('recent_wr', ROUND(_winrate_recent*100, 1),
                                 'prior_wr',  ROUND(_winrate_prior*100, 1)));
      _inserted := _inserted + 1;
    END IF;
  END LOOP;

  RETURN _inserted;
END;
$function$;

-- =========================================================
-- detect_context_patterns — case-insensitive
-- =========================================================
CREATE OR REPLACE FUNCTION public.detect_context_patterns()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record; _inserted int := 0; _wr numeric; _fake_ratio numeric;
BEGIN
  FOR r IN
    SELECT CASE WHEN entry_minute < 20 THEN '<20'
                WHEN entry_minute < 45 THEN '20-44'
                WHEN entry_minute < 65 THEN '45-64'
                ELSE '65+' END AS bucket,
           count(*) AS total,
           count(*) FILTER (WHERE upper(coalesce(result,'')) IN ('WIN','GREEN')) AS wins
    FROM signal_tracking
    WHERE finalized = true AND entry_at > now() - interval '30 days'
    GROUP BY 1
  LOOP
    IF r.total < 15 THEN CONTINUE; END IF;
    _wr := r.wins::numeric / r.total::numeric;
    IF r.bucket = '<20' AND _wr < 0.45 THEN
      INSERT INTO signal_suggestions (category, subject, severity, metric, message, payload)
      VALUES ('context', 'entry_window', 'warning', 'early_entry_low_wr',
        format('Entradas antes dos 20min têm winrate de %s%% (%s sinais)',
               ROUND(_wr*100,1), r.total),
        jsonb_build_object('bucket', r.bucket, 'wr', ROUND(_wr*100,1), 'total', r.total));
      _inserted := _inserted + 1;
    ELSIF r.bucket = '65+' AND _wr > 0.70 THEN
      INSERT INTO signal_suggestions (category, subject, severity, metric, message, payload)
      VALUES ('context', 'entry_window', 'info', 'late_entry_high_wr',
        format('Entradas após 65min performam %s%% (%s sinais) — janela favorável',
               ROUND(_wr*100,1), r.total),
        jsonb_build_object('bucket', r.bucket, 'wr', ROUND(_wr*100,1), 'total', r.total));
      _inserted := _inserted + 1;
    END IF;
  END LOOP;

  FOR r IN
    SELECT league, count(*) AS total,
           count(*) FILTER (WHERE behavior_class = 'fake_pressure') AS fakes
    FROM signal_tracking
    WHERE finalized = true AND entry_at > now() - interval '30 days'
      AND league IS NOT NULL
    GROUP BY league HAVING count(*) >= 10
  LOOP
    _fake_ratio := r.fakes::numeric / r.total::numeric;
    IF _fake_ratio > 0.30 THEN
      INSERT INTO signal_suggestions (category, subject, severity, metric, message, payload)
      VALUES ('context', r.league, 'warning', 'high_fake_pressure',
        format('Liga "%s" apresenta %s%% de fake pressure (%s/%s sinais)',
               r.league, ROUND(_fake_ratio*100,1), r.fakes, r.total),
        jsonb_build_object('ratio', ROUND(_fake_ratio*100,1), 'total', r.total));
      _inserted := _inserted + 1;
    END IF;
  END LOOP;

  FOR r IN
    SELECT public.normalize_market(market) AS market,
           count(*) AS total,
           AVG(time_to_goal_sec)/60.0 AS avg_min,
           AVG(CASE WHEN upper(coalesce(result,'')) IN ('WIN','GREEN') THEN 1 ELSE 0 END) AS wr
    FROM signal_tracking
    WHERE finalized = true AND time_to_goal_sec IS NOT NULL
      AND entry_at > now() - interval '30 days'
    GROUP BY public.normalize_market(market) HAVING count(*) >= 10
  LOOP
    IF r.avg_min > 25 AND r.wr > 0.65 THEN
      INSERT INTO signal_suggestions (category, subject, severity, metric, message, payload)
      VALUES ('context', r.market, 'info', 'late_resolution_market',
        format('Mercado "%s" resolve em média em %s min — paciência recompensa (WR %s%%)',
               r.market, ROUND(r.avg_min::numeric,1), ROUND((r.wr*100)::numeric,1)),
        jsonb_build_object('avg_min', ROUND(r.avg_min::numeric,1),
                           'wr', ROUND((r.wr*100)::numeric,1)));
      _inserted := _inserted + 1;
    END IF;
  END LOOP;

  RETURN _inserted;
END;
$function$;
