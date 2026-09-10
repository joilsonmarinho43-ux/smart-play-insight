import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders } from '../_shared/cors.ts';

const FINISHED = new Set(['FT', 'AET', 'PEN', 'AP', 'AWARDED', 'FINISHED', 'ENDED', 'FULL TIME', 'FULLTIME', 'FULL-TIME']);
type Resolution = 'green' | 'loss' | 'pending';
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : null; };

function checkMarket(market: string, f: { homeGoals: number; awayGoals: number; corners: number | null; yellowCards: number | null; offsides: number | null; finished: boolean; halfTimeGoals?: number }): Resolution {
  const totalGoals = f.homeGoals + f.awayGoals; const m = market.toLowerCase().trim();
  const finish = (yes: boolean) => yes ? 'green' : f.finished ? 'loss' : 'pending' as Resolution;
  if (m.includes('over 0.5 ht') || m.includes('over 0.5 1t') || m.includes('gol no 1º tempo') || m.includes('gol no 1° tempo')) return f.halfTimeGoals == null ? 'pending' : finish(f.halfTimeGoals > 0);
  if (m.includes('gol no 2t') || m.includes('gol no 2° tempo') || m.includes('gol no 2º tempo')) return !f.finished || f.halfTimeGoals == null ? 'pending' : finish(totalGoals > f.halfTimeGoals);

  const marketTotal = (value: number | null, names: string[]) => {
    const r = m.match(new RegExp(`over\\s*(\\d+(?:\\.\\d+)?)\\s*(?:${names.join('|')})`));
    if (r) { const t = Number(r[1]); return value == null || !Number.isFinite(t) ? 'pending' : finish(value > t); }
    const u = m.match(new RegExp(`under\\s*(\\d+(?:\\.\\d+)?)\\s*(?:${names.join('|')})`));
    if (u) { const t = Number(u[1]); return value == null || !Number.isFinite(t) ? 'pending' : finish(value < t); }
    return null;
  };
  const corners = marketTotal(f.corners, ['escanteios','cantos','corners']); if (corners) return corners;
  const cards = marketTotal(f.yellowCards, ['cart[oõ]es','cards','cartoes']); if (cards) return cards;
  const offsides = marketTotal(f.offsides, ['impedimentos','offsides','offside']); if (offsides) return offsides;

  const over = m.match(/over\s*(\d+(?:\.\d+)?)\s*(?:gols|goals)?/); if (over) return finish(totalGoals > Number(over[1]));
  const under = m.match(/under\s*(\d+(?:\.\d+)?)\s*(?:gols|goals)?/); if (under) return finish(totalGoals < Number(under[1]));
  if (m.includes('btts') || m.includes('ambas marcam')) return finish(f.homeGoals > 0 && f.awayGoals > 0);
  if (m.includes('1x') || m.includes('casa ou empate')) return f.finished ? finish(f.homeGoals >= f.awayGoals) : 'pending';
  if (m.includes('x2') || m.includes('empate ou fora')) return f.finished ? finish(f.awayGoals >= f.homeGoals) : 'pending';
  if (m.includes('vitória casa') || m.includes('vitoria casa') || m === 'casa') return f.finished ? finish(f.homeGoals > f.awayGoals) : 'pending';
  if (m.includes('vitória fora') || m.includes('vitoria fora') || m === 'fora') return f.finished ? finish(f.awayGoals > f.homeGoals) : 'pending';
  return 'pending';
}

async function getFixtureData(base: string, key: string, matchId: string) {
  const response = await fetch(`${base}/functions/v1/football-api`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ fixture: matchId }) });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null); if (!payload) return null;
  const extra = payload?.extra || {}; const homeGoals = n(extra?.goals?.home); const awayGoals = n(extra?.goals?.away); if (homeGoals == null || awayGoals == null) return null;
  const status = String(extra?.status || '').toUpperCase(); const finished = FINISHED.has(status) || /ENDED|FULL TIME|AFTER PENALT/i.test(status);
  let corners: number | null = null, yellowCards: number | null = null, offsides: number | null = null;
  for (const team of payload?.response || []) for (const stat of team?.statistics || []) {
    const type = String(stat?.type || '').toLowerCase(); const value = n(stat?.value); if (value == null) continue;
    if (type === 'corner kicks') corners = (corners ?? 0) + value;
    else if (type === 'yellow cards') yellowCards = (yellowCards ?? 0) + value;
    else if (type === 'offsides') offsides = (offsides ?? 0) + value;
  }
  const htHome = n(extra?.halftime?.home), htAway = n(extra?.halftime?.away); const halfTimeGoals = htHome != null && htAway != null ? htHome + htAway : undefined;
  return { homeGoals, awayGoals, corners, yellowCards, offsides, finished, halfTimeGoals };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const base = Deno.env.get('SUPABASE_URL'); const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'); if (!base || !key) throw new Error('SUPABASE configuration missing');
    if (req.method !== 'POST' || req.headers.get('Authorization') !== `Bearer ${key}`) return new Response(JSON.stringify({ ok: false, error: 'UNAUTHORIZED' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const sb = createClient(base, key); const { data: rows, error } = await sb.from('prediction_ledger').select('id, match_id, market, predicted_at, outcome').is('outcome', null).order('predicted_at', { ascending: true }).limit(100); if (error) throw error;
    let resolved = 0, pending = 0, skipped = 0;
    for (const row of rows || []) {
      const fixture = await getFixtureData(base, key, String(row.match_id)); if (!fixture || !fixture.finished) { pending++; continue; }
      const resolution = checkMarket(String(row.market), fixture); if (resolution === 'pending') { skipped++; continue; }
      const { error: updateError } = await sb.from('prediction_ledger').update({ outcome: resolution === 'green', resolved_at: new Date().toISOString() }).eq('id', row.id).is('outcome', null);
      if (updateError) { console.error(`[PREDICTION-LEDGER] resolution failed id=${row.id}: ${updateError.message}`); continue; }
      resolved++;
    }
    return new Response(JSON.stringify({ ok: true, scanned: rows?.length || 0, resolved, pending, skipped }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('[PREDICTION-LEDGER] resolver failed:', error); return new Response(JSON.stringify({ ok: false, error: 'RESOLVER_FAILED' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
