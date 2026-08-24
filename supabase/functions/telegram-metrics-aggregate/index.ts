// ═══════════════════════════════════════════════════════════════
// telegram-metrics-aggregate — snapshot de envios (cron 5min)
// ═══════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';


import { corsHeaders } from '../_shared/cors.ts';
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data: m5, error: e5 } = await sb.rpc('aggregate_telegram_metrics', { _window: '5min' });
    if (e5) throw e5;
    const { data: m1, error: e1 } = await sb.rpc('aggregate_telegram_metrics', { _window: '1min' });
    if (e1) throw e1;

    console.log(`[TELEGRAM_METRICS] 5min=${JSON.stringify(m5)} 1min=${JSON.stringify(m1)}`);
    return new Response(JSON.stringify({ ok: true, m5, m1 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[TELEGRAM_METRICS] error:', e);
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
