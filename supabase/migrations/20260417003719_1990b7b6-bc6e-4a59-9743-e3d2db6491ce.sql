-- Tabela para registrar sinais SNIPER/SEMI detectados (sincroniza entre dispositivos)
CREATE TABLE public.hybrid_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  match_id TEXT NOT NULL,
  match_name TEXT NOT NULL,
  league TEXT,
  tier TEXT NOT NULL CHECK (tier IN ('SNIPER','SEMI','NORMAL')),
  minute INTEGER NOT NULL DEFAULT 0,
  market TEXT NOT NULL,
  pressure NUMERIC NOT NULL DEFAULT 0,
  shots_on_goal INTEGER NOT NULL DEFAULT 0,
  total_shots INTEGER NOT NULL DEFAULT 0,
  corners INTEGER NOT NULL DEFAULT 0,
  dangerous_attacks INTEGER NOT NULL DEFAULT 0,
  da_estimated BOOLEAN NOT NULL DEFAULT false,
  possession NUMERIC NOT NULL DEFAULT 0,
  home_goals INTEGER NOT NULL DEFAULT 0,
  away_goals INTEGER NOT NULL DEFAULT 0,
  result TEXT NOT NULL DEFAULT 'PENDING' CHECK (result IN ('PENDING','WIN','LOSS','CASHOUT')),
  exit_minute INTEGER,
  entry_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  resolved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_hybrid_entries_user ON public.hybrid_entries(user_id, entry_at DESC);
CREATE INDEX idx_hybrid_entries_user_match ON public.hybrid_entries(user_id, match_id) WHERE result = 'PENDING';

ALTER TABLE public.hybrid_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own hybrid entries"
  ON public.hybrid_entries FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own hybrid entries"
  ON public.hybrid_entries FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own hybrid entries"
  ON public.hybrid_entries FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own hybrid entries"
  ON public.hybrid_entries FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins read all hybrid entries"
  ON public.hybrid_entries FOR SELECT
  TO authenticated
  USING (is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_hybrid_entries_updated
  BEFORE UPDATE ON public.hybrid_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();