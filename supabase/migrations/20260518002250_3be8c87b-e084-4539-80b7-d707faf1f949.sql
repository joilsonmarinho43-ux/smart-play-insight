
-- Backfill: copia status → result em telegram_signals quando faltante
UPDATE public.telegram_signals
   SET result = status
 WHERE result IS NULL
   AND status IN ('green','loss','void','GREEN','LOSS','VOID','WIN','RED','win','red');

-- Backfill signal_tracking
UPDATE public.signal_tracking st
   SET result = ts.status,
       finalized = true,
       finalized_at = COALESCE(st.finalized_at, ts.settled_at, now())
  FROM public.telegram_signals ts
 WHERE st.signal_id = ts.id
   AND ts.status IN ('green','loss','void','GREEN','LOSS','VOID','WIN','RED','win','red')
   AND (st.result IS NULL OR st.result = '');

-- Redefine analytics usando COALESCE(result,status)
CREATE OR REPLACE FUNCTION public.get_signal_analytics(p_days integer DEFAULT 30)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _result jsonb; _since timestamptz := now() - make_interval(days => p_days);
BEGIN
  IF NOT is_admin(auth.uid()) THEN RAISE EXCEPTION 'admin only'; END IF;

  WITH base AS (
    SELECT *,
      upper(coalesce(NULLIF(result,''), status, '')) AS r_norm,
      public.normalize_market(market) AS market_norm
    FROM telegram_signals
    WHERE created_at >= _since AND success = true
  ),
  resolved AS (SELECT * FROM base WHERE r_norm IN ('WIN','LOSS','VOID','GREEN','RED')),
  overall AS (
    SELECT count(*) AS total,
      count(*) FILTER (WHERE r_norm IN ('WIN','GREEN')) AS wins,
      count(*) FILTER (WHERE r_norm IN ('LOSS','RED'))  AS losses,
      count(*) FILTER (WHERE r_norm = 'VOID')           AS voids,
      ROUND(AVG(confidence)::numeric, 1)  AS avg_confidence,
      ROUND(AVG(roi)::numeric, 3)         AS avg_roi,
      ROUND(SUM(roi)::numeric, 2)         AS total_roi,
      CASE WHEN count(*) FILTER (WHERE r_norm IN ('WIN','LOSS','GREEN','RED')) > 0
           THEN ROUND((count(*) FILTER (WHERE r_norm IN ('WIN','GREEN'))::numeric * 100.0)
                    /  count(*) FILTER (WHERE r_norm IN ('WIN','LOSS','GREEN','RED'))::numeric, 1)
           ELSE 0 END AS winrate
    FROM resolved
  ),
  by_market AS (
    SELECT market_norm AS subject, count(*) AS total,
      count(*) FILTER (WHERE r_norm IN ('WIN','GREEN')) AS wins,
      ROUND(AVG(roi)::numeric, 3) AS avg_roi
    FROM resolved GROUP BY market_norm ORDER BY total DESC
  ),
  by_strategy AS (
    SELECT COALESCE(sensitivity,'?') AS subject, count(*) AS total,
      count(*) FILTER (WHERE r_norm IN ('WIN','GREEN')) AS wins,
      ROUND(AVG(roi)::numeric, 3) AS avg_roi
    FROM resolved GROUP BY sensitivity ORDER BY total DESC
  ),
  by_hour AS (
    SELECT EXTRACT(HOUR FROM (created_at AT TIME ZONE 'America/Sao_Paulo'))::int AS hour_brt,
      count(*) AS total,
      count(*) FILTER (WHERE r_norm IN ('WIN','GREEN')) AS wins,
      ROUND(AVG(roi)::numeric, 3) AS avg_roi
    FROM resolved GROUP BY 1 ORDER BY 1
  ),
  by_minute_window AS (
    SELECT CASE WHEN minute<15 THEN '0-14' WHEN minute<30 THEN '15-29'
                WHEN minute<45 THEN '30-44' WHEN minute<60 THEN '45-59'
                WHEN minute<75 THEN '60-74' ELSE '75+' END AS subject,
      count(*) AS total,
      count(*) FILTER (WHERE r_norm IN ('WIN','GREEN')) AS wins,
      ROUND(AVG(roi)::numeric, 3) AS avg_roi
    FROM resolved GROUP BY 1 ORDER BY 1
  ),
  by_league AS (
    SELECT COALESCE(league,'?') AS subject, count(*) AS total,
      count(*) FILTER (WHERE r_norm IN ('WIN','GREEN')) AS wins,
      ROUND(AVG(roi)::numeric, 3) AS avg_roi
    FROM resolved WHERE league IS NOT NULL GROUP BY league
    HAVING count(*) >= 3 ORDER BY 2 DESC LIMIT 20
  ),
  daily AS (
    SELECT (created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
      count(*) AS total,
      count(*) FILTER (WHERE r_norm IN ('WIN','GREEN')) AS wins,
      ROUND(AVG(roi)::numeric, 3) AS avg_roi
    FROM resolved GROUP BY 1 ORDER BY 1 DESC LIMIT 60
  ),
  streak AS (
    SELECT array_agg(r_norm ORDER BY created_at DESC)
             FILTER (WHERE r_norm <> '') AS recent
    FROM (SELECT r_norm, created_at FROM resolved ORDER BY created_at DESC LIMIT 20) s
  )
  SELECT jsonb_build_object(
    'window_days', p_days, 'generated_at', now(),
    'overall', (SELECT to_jsonb(o.*) FROM overall o),
    'by_market',        COALESCE((SELECT jsonb_agg(to_jsonb(m.*)) FROM by_market m), '[]'),
    'by_strategy',      COALESCE((SELECT jsonb_agg(to_jsonb(s.*)) FROM by_strategy s), '[]'),
    'by_hour',          COALESCE((SELECT jsonb_agg(to_jsonb(h.*)) FROM by_hour h), '[]'),
    'by_minute_window', COALESCE((SELECT jsonb_agg(to_jsonb(w.*)) FROM by_minute_window w), '[]'),
    'by_league',        COALESCE((SELECT jsonb_agg(to_jsonb(l.*)) FROM by_league l), '[]'),
    'daily',            COALESCE((SELECT jsonb_agg(to_jsonb(d.*)) FROM daily d), '[]'),
    'recent_results',   COALESCE((SELECT recent FROM streak), ARRAY[]::text[])
  ) INTO _result;
  RETURN _result;
END;
$function$;

-- Context analytics
CREATE OR REPLACE FUNCTION public.get_signal_context_analytics(p_days integer DEFAULT 30)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _result jsonb; _since timestamptz := now() - make_interval(days => p_days);
BEGIN
  IF NOT is_admin(auth.uid()) THEN RAISE EXCEPTION 'admin only'; END IF;

  WITH base AS (
    SELECT st.*,
      upper(coalesce(NULLIF(st.result,''), ts.status, '')) AS r_norm,
      public.normalize_market(st.market) AS market_norm
    FROM signal_tracking st
    LEFT JOIN telegram_signals ts ON ts.id = st.signal_id
    WHERE st.entry_at >= _since
  ),
  overall AS (
    SELECT count(*) AS total,
      ROUND(AVG(time_to_goal_sec)/60.0, 1)      AS avg_time_to_goal_min,
      ROUND(AVG(entry_pressure)::numeric, 1)    AS avg_entry_pressure,
      ROUND(AVG(avg_pressure)::numeric, 1)      AS avg_sustained_pressure,
      ROUND(AVG(pressure_drop_pct)::numeric, 3) AS avg_pressure_drop,
      ROUND(AVG(snapshot_count)::numeric, 1)    AS avg_snapshots,
      count(*) FILTER (WHERE r_norm IN ('WIN','GREEN')) AS wins,
      count(*) FILTER (WHERE r_norm IN ('WIN','LOSS','GREEN','RED')) AS resolved
    FROM base
  ),
  by_behavior AS (
    SELECT COALESCE(behavior_class,'desconhecido') AS subject, count(*) AS total,
      count(*) FILTER (WHERE r_norm IN ('WIN','GREEN')) AS wins,
      ROUND(AVG(time_to_goal_sec)/60.0, 1) AS avg_time_min,
      ROUND(AVG(avg_pressure)::numeric, 1) AS avg_pressure
    FROM base GROUP BY 1 ORDER BY 2 DESC
  ),
  by_entry_window AS (
    SELECT CASE WHEN entry_minute<15 THEN '0-14' WHEN entry_minute<30 THEN '15-29'
                WHEN entry_minute<45 THEN '30-44' WHEN entry_minute<60 THEN '45-59'
                WHEN entry_minute<75 THEN '60-74' ELSE '75+' END AS subject,
      count(*) AS total,
      count(*) FILTER (WHERE r_norm IN ('WIN','GREEN')) AS wins,
      ROUND(AVG(time_to_goal_sec)/60.0, 1) AS avg_time_min,
      ROUND(AVG(pressure_drop_pct)::numeric, 3) AS avg_drop
    FROM base GROUP BY 1 ORDER BY 1
  ),
  by_league AS (
    SELECT COALESCE(league,'?') AS subject, count(*) AS total,
      count(*) FILTER (WHERE r_norm IN ('WIN','GREEN')) AS wins,
      count(*) FILTER (WHERE behavior_class = 'fake_pressure') AS fakes,
      count(*) FILTER (WHERE behavior_class = 'dead_after_entry') AS deaths,
      ROUND(AVG(avg_pressure)::numeric, 1) AS avg_pressure,
      ROUND(AVG(pressure_drop_pct)::numeric, 3) AS avg_drop
    FROM base WHERE league IS NOT NULL GROUP BY league
    HAVING count(*) >= 3 ORDER BY 2 DESC LIMIT 20
  ),
  by_market AS (
    SELECT market_norm AS subject, count(*) AS total,
      count(*) FILTER (WHERE r_norm IN ('WIN','GREEN')) AS wins,
      ROUND(AVG(time_to_goal_sec)/60.0, 1) AS avg_time_min,
      ROUND(AVG(avg_pressure)::numeric, 1) AS avg_pressure
    FROM base GROUP BY 1 ORDER BY 2 DESC
  )
  SELECT jsonb_build_object(
    'window_days', p_days, 'generated_at', now(),
    'overall', (SELECT to_jsonb(o.*) FROM overall o),
    'by_behavior',     COALESCE((SELECT jsonb_agg(to_jsonb(b.*)) FROM by_behavior b), '[]'),
    'by_entry_window', COALESCE((SELECT jsonb_agg(to_jsonb(w.*)) FROM by_entry_window w), '[]'),
    'by_league',       COALESCE((SELECT jsonb_agg(to_jsonb(l.*)) FROM by_league l), '[]'),
    'by_market',       COALESCE((SELECT jsonb_agg(to_jsonb(m.*)) FROM by_market m), '[]')
  ) INTO _result;
  RETURN _result;
END;
$function$;
