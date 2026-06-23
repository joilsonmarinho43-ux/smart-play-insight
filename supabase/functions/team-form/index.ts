// team-form: Busca os últimos 5 jogos de cada time via TheSportsDB
// (público, sem chave obrigatória) e devolve agregados para alimentar
// modelData/sampleSize quando as fontes de fixtures (SportsRC/FDO/TSDB)
// não trazem stats avançados.
//
// Body: { home: string; away: string }
// Resp: { ok, home: {games, goalsFor, goalsAgainst, recentGoalsFor}, away: {...} }

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const TSDB = 'https://www.thesportsdb.com/api/v1/json/3';

// Cache em memória do edge worker (vida curta, por instância)
const memCache = new Map<string, { ts: number; data: any }>();
const TTL = 1000 * 60 * 60 * 12; // 12h

async function tsdb(path: string): Promise<any | null> {
  const url = `${TSDB}${path}`;
  const cached = memCache.get(url);
  if (cached && Date.now() - cached.ts < TTL) return cached.data;
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 7000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(to);
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    memCache.set(url, { ts: Date.now(), data: json });
    return json;
  } catch { return null; }
}

async function teamIdFor(name: string): Promise<string | null> {
  if (!name) return null;
  const j = await tsdb(`/searchteams.php?t=${encodeURIComponent(name)}`);
  const teams: any[] = j?.teams || [];
  // Prefer soccer
  const soccer = teams.find((t) => (t?.strSport || '').toLowerCase() === 'soccer');
  return soccer?.idTeam || teams[0]?.idTeam || null;
}

function summarize(teamName: string, events: any[]) {
  const goalsFor: number[] = [];
  const goalsAgainst: number[] = [];
  for (const ev of events) {
    const h = String(ev?.strHomeTeam || '').toLowerCase();
    const a = String(ev?.strAwayTeam || '').toLowerCase();
    const tn = teamName.toLowerCase();
    const isHome = h.includes(tn) || tn.includes(h);
    const hs = Number(ev?.intHomeScore);
    const as = Number(ev?.intAwayScore);
    if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
    if (isHome) { goalsFor.push(hs); goalsAgainst.push(as); }
    else { goalsFor.push(as); goalsAgainst.push(hs); }
  }
  const n = goalsFor.length;
  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  return {
    games: n,
    goalsForAvg: Number(avg(goalsFor).toFixed(2)),
    goalsAgainstAvg: Number(avg(goalsAgainst).toFixed(2)),
    recentGoalsFor: goalsFor.slice(0, 5),
    recentGoalsAgainst: goalsAgainst.slice(0, 5),
  };
}

async function formFor(team: string) {
  const id = await teamIdFor(team);
  if (!id) return { games: 0, goalsForAvg: 0, goalsAgainstAvg: 0, recentGoalsFor: [], recentGoalsAgainst: [] };
  const j = await tsdb(`/eventslast.php?id=${id}`);
  const events: any[] = Array.isArray(j?.results) ? j.results : [];
  return summarize(team, events.slice(0, 5));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const home = String(body?.home || '').trim();
    const away = String(body?.away || '').trim();
    if (!home || !away) {
      return new Response(JSON.stringify({ error: 'missing_teams' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const [h, a] = await Promise.all([formFor(home), formFor(away)]);
    return new Response(JSON.stringify({ ok: true, home: h, away: a }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'exception', message: err?.message || String(err) }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
