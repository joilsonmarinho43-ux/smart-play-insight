
CREATE TABLE public.superbet_captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  raw_text text,
  raw_image_url text,
  source_url text,
  market_hint text,
  parsed_json jsonb,
  status text NOT NULL DEFAULT 'pending',
  parser_version text,
  confidence numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.superbet_captures TO authenticated;
GRANT ALL ON public.superbet_captures TO service_role;

ALTER TABLE public.superbet_captures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own superbet captures"
  ON public.superbet_captures
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER superbet_captures_updated_at
  BEFORE UPDATE ON public.superbet_captures
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX superbet_captures_user_created_idx
  ON public.superbet_captures (user_id, created_at DESC);
