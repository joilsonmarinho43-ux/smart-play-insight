import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders } from '../_shared/cors.ts';

const CACHE_TTL_MS = 8 * 60 * 1000;
let client: ReturnType<typeof createClient> | null = null;
function sb() { if (!client) client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!); return client; }

async function cacheGet(key: string) {
  try {
    const { data } = await sb().from('cache_api').select('dados_json, ultima_atualizacao').eq('cache_key', key).maybeSingle();
    if (!data || Date.now() - new Date(data.ultima_atualizacao).getTime() > CACHE_TTL_MS) return null;
    return data.dados_json;
  } catch { return null; }
}
async function cacheSet(key: string, value: unknown) {
  try { await sb().from('cache_api').upsert({ cache_key: key, dados_json: value, status_jogo: 'PRE', ultima_atualizacao: new Date().toISOString() }, { onConflict: 'cache_key' }); } catch { /* cache is non-authoritative */ }
}

async function sportsrc(type: string, id: string | number) {
  const base = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  try {
    const response = await fetch(`${base}/functions/v1/free-football-proxy`, {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'sportsrc', path: '/', params: { type, id: String(id) } }),
    });
    const json = await response.json().catch(() => ({}));
    return json?.ok ? json.data ?? null : null;
  } catch { return null; }
}

function parseLineups(payload: any) {
  const d = payload?.data || payload || {};
  const home = d?.home || d?.lineups?.home || null;
  const away = d?.away || d?.lineups?.away || null;
  return {
    home: { formation: home?.formation || home?.formation_str || null, coach: home?.coach?.name || home?.coach || null, confirmed: !!home },
    away: { formation: away?.formation || away?.formation_str || null, coach: away?.coach?.name || away?.coach || null, confirmed: !!away },
    source: home || away ? 'reported_by_provider' : 'unavailable',
  };
}

function parseStanding(payload: any, homeName?: string, awayName?: string) {
  const d = payload?.data || payload || {};
  const rows: any[] = Array.isArray(d) ? d : Array.isArray(d?.standings) ? d.standings : Array.isArray(d?.standing) ? d.standing : [];
  const find = (name?: string) => name ? rows.find((r) => String(r?.team?.name || r?.name || '').toLowerCase() === name.toLowerCase()) : null;
  const label = (rank: number | null) => !rank ? 'indeterminado' : rank <= 4 ? 'disputa por título' : rank <= 6 ? 'classificação continental' : rank >= Math.max(1, rows.length - 3) ? 'luta contra rebaixamento' : 'meio-tabela';
  const h = find(homeName); const a = find(awayName);
  return { home: { stake: label(h?.rank ?? h?.position ?? null), rank: h?.rank ?? h?.position ?? null }, away: { stake: label(a?.rank ?? a?.position ?? null), rank: a?.rank ?? a?.position ?? null }, haveStandings: rows.length > 0 };
}

function median(values: number[]) {
  const v = [...values].sort((a, b) => a - b); if (!v.length) return null;
  const mid = Math.floor(v.length / 2); return Math.round((v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2) * 100) / 100;
}
function parseOdds(payload: any) {
  if (!payload) return null;
  const d = payload?.data || payload; const books: any[] = Array.isArray(d?.bookmakers) ? d.bookmakers : Array.isArray(d) ? d : [];
  if (!books.length) return null;
  const values = { home: [] as number[], draw: [] as number[], away: [] as number[], over25: [] as number[], under25: [] as number[], bttsYes: [] as number[], bttsNo: [] as number[] };
  const push = (arr: number[], value: unknown) => { const n = Number(value); if (Number.isFinite(n) && n > 1) arr.push(n); };
  for (const book of books) for (const market of (book?.markets || book?.bets || [])) {
    const name = String(market?.name || market?.market || '').toLowerCase(); const selections: any[] = market?.values || market?.odds || market?.selections || [];
    const get = (labels: string[]) => selections.find((s) => labels.includes(String(s?.value || s?.name || s?.label || '').toLowerCase()))?.odd;
    if (name.includes('match winner') || name.includes('1x2') || name === 'match result') { push(values.home, get(['home','1'])); push(values.draw, get(['draw','x'])); push(values.away, get(['away','2'])); }
    else if (name.includes('over/under') || name.includes('goals over')) { push(values.over25, get(['over 2.5'])); push(values.under25, get(['under 2.5'])); }
    else if (name.includes('both teams') || name.includes('btts')) { push(values.bttsYes, get(['yes'])); push(values.bttsNo, get(['no'])); }
  }
  return { home: median(values.home), draw: median(values.draw), away: median(values.away), over25: median(values.over25), under25: median(values.under25), bttsYes: median(values.bttsYes), bttsNo: median(values.bttsNo), meta: { bookmakers: books.length, sourceLabel: `${books.length} fonte(s); mediana`, primaryBookmaker: books[0]?.name || null } };
}

function parseFatigue(payload: any) {
  const d = payload?.data || payload || {};
  const calc = (list: any[]) => {
    const now = Date.now(); const days = list.map((m) => typeof m?.timestamp === 'number' ? (now - m.timestamp * (m.timestamp < 1e12 ? 1000 : 1)) / 86400000 : null).filter((x): x is number => x != null && x >= 0);
    return { gamesLast10d: days.filter((x) => x <= 10).length, restDays: days.length ? Math.round(Math.min(...days)) : null };
  };
  return { home: calc(Array.isArray(d?.last_home) ? d.last_home : []), away: calc(Array.isArray(d?.last_away) ? d.last_away : []) };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({})); const { fixtureId, homeName, awayName, kickoffISO } = body;
    if (!fixtureId) return new Response(JSON.stringify({ reliability: 'limitado', error: 'fixtureId required' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const key = `ctx_v2_${fixtureId}`; const cached = await cacheGet(key);
    if (cached) return new Response(JSON.stringify(cached), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const [lineupsRaw, oddsRaw, standingRaw, h2hRaw] = await Promise.all([sportsrc('lineups', fixtureId), sportsrc('odds', fixtureId), sportsrc('standing', fixtureId), sportsrc('h2h', fixtureId)]);
    const lineups = parseLineups(lineupsRaw); const odds = parseOdds(oddsRaw); const standing = parseStanding(standingRaw, homeName, awayName); const fatigue = parseFatigue(h2hRaw);
    const injuries = { home: { count: null, players: null, impact: 'unknown' }, away: { count: null, players: null, impact: 'unknown' }, source: 'unavailable' };

    const kickoffMs = kickoffISO ? new Date(kickoffISO).getTime() : NaN;
    const nearKickoff = Number.isFinite(kickoffMs) && Math.abs(kickoffMs - Date.now()) <= 2 * 3600000;
    const evidence = [!!odds, standing.haveStandings, !!fatigue.home || !!fatigue.away, !!(lineups.home.confirmed && lineups.away.confirmed)];
    const score = evidence.filter(Boolean).length;
    const reliability = score >= 4 ? 'completo' : score >= 2 ? 'parcial' : 'limitado';
    const warnings = [
      !lineups.home.confirmed || !lineups.away.confirmed ? 'lineups_unconfirmed' : null,
      nearKickoff && (!lineups.home.confirmed || !lineups.away.confirmed) ? 'lineups_expected_but_unavailable' : null,
      !odds ? 'odds_unavailable' : null,
      'injuries_unavailable',
    ].filter(Boolean);

    const result = { lineups, injuries, motivation: standing, fatigue, odds, reliability, reliabilityScore: score, warnings, generatedAt: new Date().toISOString(), provider: 'sportsrc' };
    await cacheSet(key, result);
    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ reliability: 'limitado', error: String(error) }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
