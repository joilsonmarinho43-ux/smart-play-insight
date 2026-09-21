import { corsHeaders } from '../_shared/cors.ts';

/**
 * NEXUS 33 — scanner-pro-server
 *
 * HARDENING: this endpoint is intentionally quarantined until the live feed
 * supplies a verified OBSERVED betting odd for the selected market.
 *
 * The previous implementation derived an odd/fair price from the model
 * probability and then calculated EV from that same probability. That is
 * circular and cannot be used as market value. It also contaminated the
 * opportunity score before the downstream Telegram gate.
 *
 * Rule:
 *   model probability -> OBSERVED market odd -> implied probability + EV
 *
 * No verified observed-odds source is currently present in football-api, so
 * the scanner must produce zero signals rather than manufacture an odd/EV.
 */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const configuredServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = req.headers.get('authorization')?.replace(/^Bearer\\s+/i, '').trim() || '';
  const apiKey = req.headers.get('apikey')?.trim() || '';
  if (!configuredServiceKey || (authorization !== configuredServiceKey && apiKey !== configuredServiceKey)) {
    return new Response(JSON.stringify({ success: false, signals: 0, reason: 'INTERNAL_CALL_REQUIRED' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Variáveis de ambiente não configuradas');
    }

    const response = await fetch(`${supabaseUrl}/functions/v1/football-api`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ live: true }),
    });

    const payload = await response.json().catch(() => ({}));
    const matches = Array.isArray(payload?.matches) ? payload.matches : [];

    console.log(
      `[SNIPER-QUARANTINE] analyzed=${matches.length} signals=0 reason=REAL_OBSERVED_ODDS_REQUIRED`,
    );

    return new Response(
      JSON.stringify({
        success: true,
        signals: 0,
        analyzed: matches.length,
        quarantined: true,
        reason: 'REAL_OBSERVED_ODDS_REQUIRED',
        message: 'Scanner bloqueado até existir odd observada real para o mercado.',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('[SNIPER-QUARANTINE] Erro:', error);
    return new Response(
      JSON.stringify({
        success: false,
        signals: 0,
        reason: 'SCANNER_UNAVAILABLE',
        error: error instanceof Error ? error.message : 'Erro desconhecido',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
