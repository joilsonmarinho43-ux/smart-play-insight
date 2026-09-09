import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders } from '../_shared/cors.ts';

const FINISHED = new Set(['FT', 'AET', 'PEN', 'AP', 'AWARDED', 'FINISHED', 'ENDED', 'FULL TIME', 'FULLTIME', 'FULL-TIME']);

type Resolution = 'green' | 'loss' | 'pending';

function finiteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function checkMarket(
  market: string,
  homeGoals: number,
  awayGoals: number,
  corners: number,
  finished: boolean,
  halfTimeGoals?: number,
): Resolution {
  const totalGoals = homeGoals + awayGoals;
  const m = market.toLowerCase().trim();

  // Period markets must be evaluated only from their own period result.
  if (m.includes('over 0.5 ht') || m.includes('over 0.5 1t') || m.includes('gol no 1º tempo') || m.includes('gol no 1° tempo')) {
    if (halfTimeGoals == null) return 'pending';
    return halfTimeGoals > 0 ? 'green' : 'loss';
  }
  if (m.includes('gol no 2t') || m.includes('gol no 2° tempo') || m.includes('gol no 2º tempo')) {
    if (!finished) return 'pending';
    return totalGoals > halfTimeGoals ? 'green' : 'loss';
  }

  const over = m.match(/over\s*(\d+(?:\.\d+)?)\s*(?:gols|goals)?/);
  if (over) {
    const threshold = Number(over[1]);
    if (!Number.isFinite(threshold)) return 'pending';
    if (totalGoals > threshold) return 'green';
    return finished ? 'loss' : 'pending';
  }

  const under = m.match(/under\s*(\d+(?:\.\d+)?)\s*(?:gols|goals)?/);
  if (under) {
    const threshold = Number(under[1]);
    if (!Number.isFinite(threshold)) return 'pending';
    if (totalGoals < threshold) return 'green';
    return finished ? 'loss' : 'pending';
  }

  if (m.includes('btts') || m.includes('ambas marcam')) {
    if (homeGoals > 0 && awayGoals > 0) return 'green';
    return finished ? 'loss' : 'pending';
  }

  const cornersOver = m.match(/over\s*(\d+(?:\.\d+)?)\s*(?:escanteios|cantos|corners)/);
  if (cornersOver) {
    const threshold = Number(cornersOver[1]);
    if (!Number.isFinite(threshold)) return 'pending';
    if (corners > threshold) return 'green';
    return finished ? 'loss' : 'pending';
  }

  if (m.includes('1x') || m.includes('casa ou empate')) {
    if (!finished) return 'pending';
    return homeGoals >= awayGoals ? 'green' : 'loss';
  }
  if (m.includes('x2') || m.includes('empate ou fora')) {
    if (!finished) return 'pending';
    return awayGoals >= homeGoals ? 'green' : 'loss';
  }
  if (m.includes('vitória casa') || m.includes('vitoria casa') || m === 'casa') {
    if (!finished) return 'pending';
    return homeGoals > awayGoals ? 'green' : 'loss';
  }
  if (m.includes('vitória fora') || m.includes('vitoria fora') || m === 'fora') {
    if (!finished) return 'pending';
    return awayGoals > homeGoals ? 'green' : 'loss';
  }

  // Unknown markets are deliberately left unresolved. Never manufacture a LOSS.
  return 'pending';
}

async function getFixtureData(supabaseUrl: string, serviceKey: string, matchId: string) {
  const response = await fetch(`${supabaseUrl}/functions/v1/football-api`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fixture: matchId }),
  });
  if (!response.ok) return null;

  const payload = await response.json().catch(() => null);
  if (!payload) return null;

  const extra = payload?.extra || {};
  const goalsHome = finiteNumber(extra?.goals?.home);
  const goalsAway = finiteNumber(extra?.goals?.away);
  if (goalsHome == null || goalsAway == null) return null;

  const status = String(extra?.status || '').toUpperCase();
  const finished = FINISHED.has(status) || /ENDED|FULL TIME|AFTER PENALT/i.test(status);

  let corners = 0;
  for (const team of payload?.response || []) {
    const stat = (team?.statistics || []).find((s: any) => s?.type === 'Corner Kicks');
    const value = finiteNumber(stat?.value);
    if (value != null) corners += value;
  }

  const htHome = finiteNumber(extra?.halftime?.home);
  const htAway = finiteNumber(extra?.halftime?.away);
  const halfTimeGoals = htHome != null && htAway != null ? htHome + htAway : undefined;

  return { goalsHome, goalsAway, corners, finished, halfTimeGoals };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY or SUPABASE_URL missing');

    const sb = createClient(supabaseUrl, serviceKey);
    const { data: rows, error } = await sb
      .from('prediction_ledger')
      .select('id, prediction_id, match_id, market, predicted_at, outcome')
      .is('outcome', null)
      .order('predicted_at', { ascending: true })
      .limit(100);

    if (error) throw new Error(`ledger_fetch_failed: ${error.message}`);

    let resolved = 0;
    let pending = 0;
    let skipped = 0;

    for (const row of rows || []) {
      const fixture = await getFixtureData(supabaseUrl, serviceKey, String(row.match_id));
      if (!fixture || !fixture.finished) {
        pending++;
        continue;
      }

      const resolution = checkMarket(
        String(row.market),
        fixture.goalsHome,
        fixture.goalsAway,
        fixture.corners,
        fixture.finished,
        fixture.halfTimeGoals,
      );

      if (resolution === 'pending') {
        skipped++;
        continue;
      }

      const { error: updateError } = await sb
        .from('prediction_ledger')
        .update({
          outcome: resolution === 'green',
          resolved_at: new Date().toISOString(),
        })
        .eq('id', row.id)
        .is('outcome', null);

      if (updateError) {
        // The immutable trigger intentionally rejects invalid/racing mutations.
        console.error(`[PREDICTION-LEDGER] resolution failed id=${row.id}: ${updateError.message}`);
        continue;
      }

      resolved++;
    }

    return new Response(JSON.stringify({ ok: true, scanned: rows?.length || 0, resolved, pending, skipped }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[PREDICTION-LEDGER] resolver failed:', error);
    return new Response(JSON.stringify({ ok: false, error: 'RESOLVER_FAILED' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
