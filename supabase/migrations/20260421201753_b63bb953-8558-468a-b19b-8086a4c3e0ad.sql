
-- Add rma_verdict column to telegram_signals for shadow logging
ALTER TABLE public.telegram_signals ADD COLUMN IF NOT EXISTS rma_verdict text;
ALTER TABLE public.telegram_signals ADD COLUMN IF NOT EXISTS rma_score numeric;

-- Create dedicated RMA shadow log table
CREATE TABLE public.rma_shadow_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id text NOT NULL,
  match_name text NOT NULL,
  market text NOT NULL,
  minute integer NOT NULL DEFAULT 0,
  original_signal text,
  rma_verdict text NOT NULL,
  rma_score numeric NOT NULL DEFAULT 0,
  ap_norm numeric,
  f_norm numeric,
  sot_norm numeric,
  acceleration numeric DEFAULT 0,
  block_reason text,
  match_result text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.rma_shadow_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read RMA logs"
  ON public.rma_shadow_logs FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));
