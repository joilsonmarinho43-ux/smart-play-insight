import { corsHeaders } from '../_shared/cors.ts';

/**
 * Telegram signal emission is intentionally disabled until it is wired to the
 * same authoritative Nexus Core decision and Prediction Ledger path used by
 * the application. No independent RMA/heuristic signal may be published.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  return new Response(JSON.stringify({
    success: true,
    disabled: true,
    reason: 'CORE_ONLY_SIGNAL_PATH',
  }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
