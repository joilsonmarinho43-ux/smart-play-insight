// CORS headers compartilhados.
//
// IMPORTANTE: NÃO usar `npm:@supabase/supabase-js@2/cors` — esse subpath só
// existe no runtime hospedado do Lovable. No edge-runtime self-hosted (VPS)
// ele falha ao resolver e a função inteira quebra no boot (500), derrubando
// Placar Exato / Elite / Scanner PRO / Bet Analyzer / Bingo VIP PRO.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
};
