
CREATE TABLE public.cache_api (
  cache_key TEXT PRIMARY KEY,
  dados_json JSONB NOT NULL DEFAULT '{}',
  status_jogo TEXT NOT NULL DEFAULT 'PRE',
  ultima_atualizacao TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.cache_api ENABLE ROW LEVEL SECURITY;

-- Anyone can read (public football data)
CREATE POLICY "Cache is publicly readable"
ON public.cache_api
FOR SELECT
TO anon, authenticated
USING (true);

-- Only service role (edge functions) can write — no user-level INSERT/UPDATE/DELETE policies needed
-- Edge functions use service role key which bypasses RLS

-- Index for fast lookups by status
CREATE INDEX idx_cache_api_status ON public.cache_api (status_jogo);

-- Index for cleanup of old entries
CREATE INDEX idx_cache_api_updated ON public.cache_api (ultima_atualizacao);
