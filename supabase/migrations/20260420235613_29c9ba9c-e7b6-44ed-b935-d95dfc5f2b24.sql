
ALTER TABLE public.telegram_signals
  ADD COLUMN telegram_message_id BIGINT,
  ADD COLUMN status TEXT NOT NULL DEFAULT 'pendente',
  ADD COLUMN match_id TEXT;
