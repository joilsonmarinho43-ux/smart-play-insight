import { corsHeaders } from '../_shared/cors.ts';

/** Legacy betting-style daily broadcast is disabled for the analyst-only product. */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  return new Response(JSON.stringify({
    ok: true,
    disabled: true,
    reason: 'ANALYST_ONLY_PRODUCT',
    message: 'Automated Bet Analyzer broadcast is disabled. Analytical decisions belong to Nexus Core.',
  }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
