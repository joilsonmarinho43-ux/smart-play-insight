
ALTER TABLE public.telegram_signals
  ADD COLUMN IF NOT EXISTS odd numeric,
  ADD COLUMN IF NOT EXISTS implied_probability numeric,
  ADD COLUMN IF NOT EXISTS expected_value numeric,
  ADD COLUMN IF NOT EXISTS result text,
  ADD COLUMN IF NOT EXISTS settled_at timestamptz,
  ADD COLUMN IF NOT EXISTS edited_message boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS roi numeric,
  ADD COLUMN IF NOT EXISTS market_type text,
  ADD COLUMN IF NOT EXISTS premium_score numeric,
  ADD COLUMN IF NOT EXISTS model_probability numeric;

ALTER TABLE public.telegram_signals ALTER COLUMN success DROP NOT NULL;
ALTER TABLE public.telegram_signals ALTER COLUMN success DROP DEFAULT;

CREATE INDEX IF NOT EXISTS idx_telegram_signals_status_match ON public.telegram_signals(status, match_id);
CREATE INDEX IF NOT EXISTS idx_telegram_signals_settled_at ON public.telegram_signals(settled_at DESC);
