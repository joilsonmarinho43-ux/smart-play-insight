-- =============================================================
-- Signal Context Intelligence — tracking pós-sinal, classificação
-- comportamental, analytics contextual e sugestões estratégicas.
-- Não altera engines. Apenas observa.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.signal_tracking (
  signal_id          uuid PRIMARY KEY,
  match_id           text NOT NULL,
  match_name         text,
  league             text,
  market             text,
  entry_minute       integer NOT NULL DEFAULT 0,
  entry_at           timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  snapshot_count     integer NOT NULL DEFAULT 0,
  snapshots          jsonb   NOT NULL DEFAULT '[]'::jsonb,
  -- aggregates
  entry_pressure     numeric,
  peak_pressure      numeric,
  min_pressure       numeric,
  avg_pressure       numeric,
  pressure_std       numeric,
  pressure_drop_pct  numeric,   -- (entry - min)/entry
  goals_after        integer NOT NULL DEFAULT 0,
  first_goal_minute  integer,
  time_to_goal_sec   integer,
  last_pressure      numeric,
  -- final
  behavior_class     text,
  finalized          boolean NOT NULL DEFAULT false,
  finalized_at       timestamptz,
  result             text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signal_tracking_match     ON public.signal_tracking (match_id);
CREATE INDEX IF NOT EXISTS idx_signal_tracking_finalized ON public.signal_tracking (finalized, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_signal_tracking_entry     ON public.signal_tracking (entry_at DESC);
CREATE INDEX IF NOT EXISTS idx_signal_tracking_behavior  ON public.signal_tracking (behavior_class);

ALTER TABLE public.signal_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read signal tracking"
  ON public.signal_tracking FOR SELECT
  TO authenticated
  USING (is_admin(auth.uid()));

CREATE TRIGGER trg_signal_tracking_updated_at
BEFORE UPDATE ON public.signal_tracking
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================
-- RPC: contexto analytics agregado
-- =============================================================
CREATE OR REPLACE FUNCTION public.get_signal_context_analytics(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _result jsonb;
  _since timestamptz := now() - make_interval(days => p_days);
BEGIN
  IF NOT is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  WITH base AS (
    SELECT * FROM signal_tracking
    WHERE entry_at >= _since AND finalized = true
  ),
  overall AS (
    SELECT
      count(*) AS total,
      ROUND(AVG(time_to_goal_sec)/60.0, 1)        AS avg_time_to_goal_min,
      ROUND(AVG(entry_pressure)::numeric, 1)      AS avg_entry_pressure,
      ROUND(AVG(avg_pressure)::numeric, 1)        AS avg_sustained_pressure,
      ROUND(AVG(pressure_drop_pct)::numeric, 3)   AS avg_pressure_drop,
      ROUND(AVG(snapshot_count)::numeric, 1)      AS avg_snapshots
    FROM base
  ),
  by_behavior AS (
    SELECT COALESCE(behavior_class,'desconhecido') AS subject,
           count(*) AS total,
           count(*) FILTER (WHERE result IN ('WIN','GREEN')) AS wins,
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
    count(*) FILTER (WHERE result IN ('WIN','GREEN')) AS wins,
    ROUND(AVG(time_to_goal_sec)/60.0, 1) AS avg_time_min,
    ROUND(AVG(pressure_drop_pct)::numeric, 3) AS avg_drop
    FROM base GROUP BY 1 ORDER BY 1
  ),
  by_league AS (
    SELECT COALESCE(league,'?') AS subject,
           count(*) AS total,
           count(*) FILTER (WHERE result IN ('WIN','GREEN')) AS wins,
           count(*) FILTER (WHERE behavior_class = 'fake_pressure') AS fakes,
           count(*) FILTER (WHERE behavior_class = 'dead_after_entry') AS deaths,
           ROUND(AVG(avg_pressure)::numeric, 1) AS avg_pressure,
           ROUND(AVG(pressure_drop_pct)::numeric, 3) AS avg_drop
    FROM base
    WHERE league IS NOT NULL
    GROUP BY league
    HAVING count(*) >= 3
    ORDER BY 2 DESC
    LIMIT 20
  ),
  by_market AS (
    SELECT market AS subject,
           count(*) AS total,
           count(*) FILTER (WHERE result IN ('WIN','GREEN')) AS wins,
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
$$;

REVOKE ALL ON FUNCTION public.get_signal_context_analytics(integer) FROM PUBLIC, anon;

-- =============================================================
-- Detecção de padrões contextuais → sugestões estratégicas
-- =============================================================
CREATE OR REPLACE FUNCTION public.detect_context_patterns()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  _inserted int := 0;
  _wr numeric;
  _fake_ratio numeric;
BEGIN
  -- Janela de entrada × winrate (últimos 30d)
  FOR r IN
    SELECT
      CASE WHEN entry_minute < 20 THEN '<20'
           WHEN entry_minute < 45 THEN '20-44'
           WHEN entry_minute < 65 THEN '45-64'
           ELSE '65+' END AS bucket,
      count(*) AS total,
      count(*) FILTER (WHERE result IN ('WIN','GREEN')) AS wins,
      AVG(CASE WHEN result IN ('WIN','GREEN') THEN 1 ELSE 0 END) AS wr
    FROM signal_tracking
    WHERE finalized = true AND entry_at > now() - interval '30 days'
    GROUP BY 1
  LOOP
    IF r.total < 15 THEN CONTINUE; END IF;
    _wr := r.wins::numeric / r.total;
    IF r.bucket = '<20' AND _wr < 0.45 THEN
      INSERT INTO signal_suggestions (category, subject, severity, metric, message, payload)
      VALUES ('context', 'entry_window', 'warning', 'early_entry_low_wr',
        format('Entradas antes dos 20min têm winrate de %s%% (%s sinais) — ROI possivelmente negativo',
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

  -- Liga com alta taxa de fake_pressure
  FOR r IN
    SELECT league,
           count(*) AS total,
           count(*) FILTER (WHERE behavior_class = 'fake_pressure') AS fakes
    FROM signal_tracking
    WHERE finalized = true
      AND entry_at > now() - interval '30 days'
      AND league IS NOT NULL
    GROUP BY league
    HAVING count(*) >= 10
  LOOP
    _fake_ratio := r.fakes::numeric / r.total;
    IF _fake_ratio > 0.30 THEN
      INSERT INTO signal_suggestions (category, subject, severity, metric, message, payload)
      VALUES ('context', r.league, 'warning', 'high_fake_pressure',
        format('Liga "%s" apresenta %s%% de fake pressure (%s/%s sinais)',
               r.league, ROUND(_fake_ratio*100,1), r.fakes, r.total),
        jsonb_build_object('ratio', ROUND(_fake_ratio*100,1), 'total', r.total));
      _inserted := _inserted + 1;
    END IF;
  END LOOP;

  -- Mercado com tempo médio alto até gol (>25min) e bom WR
  FOR r IN
    SELECT market,
           count(*) AS total,
           AVG(time_to_goal_sec)/60.0 AS avg_min,
           AVG(CASE WHEN result IN ('WIN','GREEN') THEN 1 ELSE 0 END) AS wr
    FROM signal_tracking
    WHERE finalized = true
      AND time_to_goal_sec IS NOT NULL
      AND entry_at > now() - interval '30 days'
    GROUP BY market HAVING count(*) >= 10
  LOOP
    IF r.avg_min > 25 AND r.wr > 0.65 THEN
      INSERT INTO signal_suggestions (category, subject, severity, metric, message, payload)
      VALUES ('context', r.market, 'info', 'late_resolution_market',
        format('Mercado "%s" resolve em média em %s min — paciência recompensa (WR %s%%)',
               r.market, ROUND(r.avg_min::numeric,1), ROUND((r.wr*100)::numeric,1)),
        jsonb_build_object('avg_min', ROUND(r.avg_min::numeric,1), 'wr', ROUND((r.wr*100)::numeric,1)));
      _inserted := _inserted + 1;
    END IF;
  END LOOP;

  RETURN _inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.detect_context_patterns() FROM PUBLIC, anon, authenticated;