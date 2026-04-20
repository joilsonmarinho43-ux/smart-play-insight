
CREATE TABLE public.telegram_signals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  match_name TEXT NOT NULL,
  market TEXT NOT NULL,
  confidence INTEGER NOT NULL DEFAULT 0,
  filters_validated TEXT,
  sensitivity TEXT,
  minute INTEGER NOT NULL DEFAULT 0,
  score TEXT,
  poisson TEXT,
  odd_min TEXT,
  janela TEXT,
  reason TEXT,
  success BOOLEAN NOT NULL DEFAULT true,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.telegram_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read telegram signals"
ON public.telegram_signals
FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));
