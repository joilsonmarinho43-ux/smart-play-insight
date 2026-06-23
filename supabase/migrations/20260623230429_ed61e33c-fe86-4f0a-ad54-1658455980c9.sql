
CREATE TABLE public.superbet_parser_health (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capture_id uuid REFERENCES public.superbet_captures(id) ON DELETE CASCADE,
  parser_version text NOT NULL,
  kind text,
  confidence numeric,
  missing_fields text[] NOT NULL DEFAULT ARRAY[]::text[],
  fallbacks_used text[] NOT NULL DEFAULT ARRAY[]::text[],
  vision_used boolean NOT NULL DEFAULT false,
  sportsrc_used boolean NOT NULL DEFAULT false,
  sportsrc_matched boolean NOT NULL DEFAULT false,
  notes text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX superbet_parser_health_created_idx ON public.superbet_parser_health (created_at DESC);
CREATE INDEX superbet_parser_health_missing_idx ON public.superbet_parser_health USING GIN (missing_fields);

GRANT SELECT ON public.superbet_parser_health TO authenticated;
GRANT ALL ON public.superbet_parser_health TO service_role;

ALTER TABLE public.superbet_parser_health ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read parser health"
  ON public.superbet_parser_health
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Service role manages parser health"
  ON public.superbet_parser_health
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
