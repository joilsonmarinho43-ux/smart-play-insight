CREATE TABLE IF NOT EXISTS public.team_form_kv (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_form_kv TO authenticated;
GRANT ALL ON public.team_form_kv TO service_role;
ALTER TABLE public.team_form_kv ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team_form_kv service write" ON public.team_form_kv FOR ALL TO service_role USING (true) WITH CHECK (true);