// team-form: Últimos 5 jogos por time via TheSportsDB (free, key '123').
// FDO foi desativado (conta bloqueada). TSDB cobre praticamente todas as ligas
// e não exige chave paga.
//
// Body: { home: string; away: string }
// Resp: { ok, home: SideForm, away: SideForm }

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const TSDB_BASE = 'https://www.thesportsdb.com/api/v1/json/123';

const teamIdByName = new Map<string, string>();
const lastEventsCache = new Map<string, { ts: number; data: any[] }>();
const TTL = 1000 * 60 * 60 * 6;

function normalize(name: string): string {
  return String(name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(fc|cf|sc|ac|afc|cfc|club|clube|de|do|da)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const TEAM_ALIASES: Record<string, string> = {
  'argelia': 'Algeria',
  'inglaterra': 'England',
  'jordania': 'Jordan',
  'colombia': 'Colombia',
  'rd congo': 'DR Congo',
  'republica democratica do congo': 'DR Congo',
  'uzbequistao': 'Uzbekistan',
  'gana': 'Ghana',
  'panama': 'Panama',
  'croacia': 'Croatia',
  'alemanha': 'Germany',
  'espanha': 'Spain',
  'italia': 'Italy',
  'franca': 'France',
  'paises baixos': 'Netherlands',
  'holanda': 'Netherlands',
  'belgica': 'Belgium',
  'suica': 'Switzerland',
  'suecia': 'Sweden',
  'dinamarca': 'Denmark',
  'polonia': 'Poland',
  'marrocos': 'Morocco',
  'egito': 'Egypt',
  'japao': 'Japan',
  'coreia do sul': 'South Korea',
  'estados unidos': 'United States',
  'eua': 'United States',
};

async function tsdb(path: string): Promise<any | null> {
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(TSDB_BASE + path, { signal: ctrl.signal });
    clearTimeout(to);
    if (!res.ok) {
      console.warn(`[team-form] TSDB ${path} -> ${res.status}`);
      return null;
    }
    return await res.json().catch(() => null);
  } catch (e) {
    console.warn('[team-form] tsdb error', path, String(e));
    return null;
  }
}

async function resolveTeamId(name: string): Promise<string | null> {
  const k = normalize(name);
  if (!k) return null;
  if (teamIdByName.has(k)) return teamIdByName.get(k)!;

  // Tenta nome bruto, alias em inglês e normalizado
  const alias = TEAM_ALIASES[k];
  const variants = Array.from(new Set([name.trim(), alias, k].filter(Boolean)));
  for (const q of variants) {
    const j = await tsdb(`/searchteams.php?t=${encodeURIComponent(q)}`);
    const teams: any[] = j?.teams || [];
    // Prefere times de futebol
    const soccer = teams.filter((t) => /soccer|football/i.test(t?.strSport || ''));
    const pool = soccer.length ? soccer : teams;
    if (!pool.length) continue;

    // Match exato normalizado
    let pick = pool.find((t) => normalize(t?.strTeam || '') === k || (alias && normalize(t?.strTeam || '') === normalize(alias)))
            || pool.find((t) => normalize(t?.strTeam || '').includes(k) || k.includes(normalize(t?.strTeam || '')))
            || pool[0];
    if (pick?.idTeam) {
      teamIdByName.set(k, pick.idTeam);
      return pick.idTeam;
    }
  }
  return null;
}

async function lastEvents(teamId: string): Promise<any[]> {
  const cached = lastEventsCache.get(teamId);
  if (cached && Date.now() - cached.ts < TTL) return cached.data;
  const j = await tsdb(`/eventslast.php?id=${teamId}`);
  const evts: any[] = j?.results || [];
  lastEventsCache.set(teamId, { ts: Date.now(), data: evts });
  return evts;
}

function summarize(teamId: string, evts: any[]) {
  const sorted = [...evts].sort((a, b) => {
    const da = new Date(a?.dateEvent || 0).getTime();
    const db = new Date(b?.dateEvent || 0).getTime();
    return db - da;
  });
  const last5 = sorted.slice(0, 5);
  const gf: number[] = [];
  const ga: number[] = [];
  for (const e of last5) {
    const hs = Number(e?.intHomeScore);
    const as = Number(e?.intAwayScore);
    if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
    const isHome = String(e?.idHomeTeam) === String(teamId);
    gf.push(isHome ? hs : as);
    ga.push(isHome ? as : hs);
  }
  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  return {
    games: gf.length,
    goalsForAvg: Number(avg(gf).toFixed(2)),
    goalsAgainstAvg: Number(avg(ga).toFixed(2)),
    recentGoalsFor: gf,
    recentGoalsAgainst: ga,
  };
}

async function formFor(name: string) {
  const id = await resolveTeamId(name);
  if (!id) return { games: 0, goalsForAvg: 0, goalsAgainstAvg: 0, recentGoalsFor: [], recentGoalsAgainst: [], teamId: null };
  const evts = await lastEvents(id);
  return { ...summarize(id, evts), teamId: id };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const home = String(body?.home || '').trim();
    const away = String(body?.away || '').trim();
    if (!home || !away) {
      return new Response(JSON.stringify({ error: 'missing_teams' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
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
