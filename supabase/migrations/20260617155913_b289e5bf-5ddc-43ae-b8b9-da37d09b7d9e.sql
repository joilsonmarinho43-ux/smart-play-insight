
-- 1) match_stats_fallback
CREATE TABLE public.match_stats_fallback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id text NOT NULL UNIQUE,
  home_team text NOT NULL,
  away_team text NOT NULL,
  league text,
  kickoff_at timestamptz,
  avg_goals numeric,
  avg_corners numeric,
  btts_pct numeric,
  over05_pct numeric,
  over15_pct numeric,
  over25_pct numeric,
  over35_pct numeric,
  clean_sheets_pct numeric,
  home_form text,
  away_form text,
  h2h_json jsonb,
  source text NOT NULL CHECK (source IN ('api-football','thesportsdb','historical','mixed')),
  confidence_score integer NOT NULL CHECK (confidence_score BETWEEN 0 AND 100),
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_msf_match_id ON public.match_stats_fallback (match_id);
CREATE INDEX idx_msf_kickoff ON public.match_stats_fallback (kickoff_at DESC);
CREATE INDEX idx_msf_updated ON public.match_stats_fallback (updated_at DESC);

GRANT SELECT ON public.match_stats_fallback TO authenticated;
GRANT ALL ON public.match_stats_fallback TO service_role;

ALTER TABLE public.match_stats_fallback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read fallback stats"
  ON public.match_stats_fallback FOR SELECT
  TO authenticated USING (true);

CREATE TRIGGER trg_msf_updated_at
  BEFORE UPDATE ON public.match_stats_fallback
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) fallback_logs
CREATE TABLE public.fallback_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id text,
  source_used text NOT NULL,
  latency_ms integer,
  cache_hit boolean NOT NULL DEFAULT false,
  api_football_failed boolean NOT NULL DEFAULT false,
  confidence_score integer,
  signals_generated integer NOT NULL DEFAULT 0,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_fl_created ON public.fallback_logs (created_at DESC);
CREATE INDEX idx_fl_source ON public.fallback_logs (source_used);

GRANT SELECT ON public.fallback_logs TO authenticated;
GRANT ALL ON public.fallback_logs TO service_role;

ALTER TABLE public.fallback_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin read fallback logs"
  ON public.fallback_logs FOR SELECT
  TO authenticated USING (public.is_admin(auth.uid()));
