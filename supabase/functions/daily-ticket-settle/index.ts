import { corsHeaders } from '../_shared/cors.ts';

/** Legacy ticket settlement is disabled. Prediction calibration belongs to the immutable ledger. */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  return new Response(JSON.stringify({
    ok: true,
    disabled: true,
    reason: 'PREDICTION_LEDGER_IS_SINGLE_RESULT_SOURCE',
    message: 'Legacy ticket settlement is disabled; only the audited prediction ledger resolves analytical outcomes.',
  }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
