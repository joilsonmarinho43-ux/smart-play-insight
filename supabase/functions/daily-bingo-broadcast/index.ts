import { corsHeaders } from '../_shared/cors.ts';

/**
 * Legacy endpoint intentionally neutralized.
 * Nexus 33 is an analytical product; this function must not manufacture
 * probabilities, odds, entries, ROI adjustments, or automated betting CTAs.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  return new Response(JSON.stringify({
    ok: true,
    disabled: true,
    reason: 'ANALYST_ONLY_PRODUCT',
    message: 'Automated betting-style broadcast is disabled. Use Nexus Core analytical signals.',
  }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
