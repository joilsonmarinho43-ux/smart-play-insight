import { corsHeaders } from '../_shared/cors.ts';

/**
 * Legacy automatic decision endpoint intentionally neutralized.
 * Official analytical decisions must be produced by Nexus Core so that
 * calibration, provenance and data-quality gates cannot be bypassed.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  return new Response(JSON.stringify({
    ok: true,
    disabled: true,
    reason: 'NEXUS_CORE_IS_SINGLE_DECISION_AUTHORITY',
    message: 'Independent Auto Mode decisions are disabled. Use the Nexus Core analytical pipeline.',
  }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
