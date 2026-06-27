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
  'arabia saudita': 'Saudi Arabia',
  'cabo verde': 'Cape Verde',
  'costa do marfim': 'Ivory Coast',
  'camaroes': 'Cameroon',
  'senegal': 'Senegal',
  'tunisia': 'Tunisia',
  'nigeria': 'Nigeria',
  'africa do sul': 'South Africa',
  'austria': 'Austria',
  'turquia': 'Turkey',
  'russia': 'Russia',
  'ucrania': 'Ukraine',
  'servia': 'Serbia',
  'romenia': 'Romania',
  'grecia': 'Greece',
  'irlanda': 'Republic of Ireland',
  'irlanda do norte': 'Northern Ireland',
  'pais de gales': 'Wales',
  'escocia': 'Scotland',
  'chequia': 'Czech Republic',
  'republica tcheca': 'Czech Republic',
  'eslovaquia': 'Slovakia',
  'eslovenia': 'Slovenia',
  'hungria': 'Hungary',
  'noruega': 'Norway',
  'finlandia': 'Finland',
  'islandia': 'Iceland',
  'mexico': 'Mexico',
  'paraguai': 'Paraguay',
  'uruguai': 'Uruguay',
  'equador': 'Ecuador',
  'venezuela': 'Venezuela',
  'peru': 'Peru',
  'chile': 'Chile',
  'bolivia': 'Bolivia',
  'australia': 'Australia',
  'nova zelandia': 'New Zealand',
  'ira': 'Iran',
  'iraque': 'Iraq',
  'catar': 'Qatar',
  'emirados arabes': 'United Arab Emirates',
  'china': 'China PR',
  'coreia do norte': 'North Korea',
  'estonia': 'Estonia',
  'letonia': 'Latvia',
  'lituania': 'Lithuania',
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
  const variants = Array.from(new Set([alias, name.trim(), k].filter(Boolean)));
  let fallbackPick: any = null;
  for (const q of variants) {
    const j = await tsdb(`/searchteams.php?t=${encodeURIComponent(q)}`);
    const teams: any[] = j?.teams || [];
    // Prefere times de futebol
    const soccer = teams.filter((t) => /soccer|football/i.test(t?.strSport || ''));
    if (!fallbackPick && teams[0]) fallbackPick = teams[0];
    const pool = soccer;
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
  if (fallbackPick?.idTeam) {
    teamIdByName.set(k, fallbackPick.idTeam);
    return fallbackPick.idTeam;
  }
  return null;
}

function isPlayed(e: any): boolean {
  const hs = Number(e?.intHomeScore);
  const as = Number(e?.intAwayScore);
  return Number.isFinite(hs) && Number.isFinite(as);
}

function currentSeasons(): string[] {
  const now = new Date();
  const y = now.getFullYear();
  // Cobre ligas calendário (2025, 2026) e europeu (2025-2026, 2024-2025)
  return [`${y}-${y + 1}`, `${y - 1}-${y}`, String(y), String(y - 1)];
}

async function lastEventsBase(teamId: string): Promise<any[]> {
  const j = await tsdb(`/eventslast.php?id=${teamId}`);
  return j?.results || [];
}

async function teamLeagues(teamId: string): Promise<string[]> {
  const j = await tsdb(`/lookupteam.php?id=${teamId}`);
  const t = j?.teams?.[0];
  const ids = new Set<string>();
  if (t?.idLeague) ids.add(String(t.idLeague));
  // ligas adicionais (copa nacional, internacional)
  for (let i = 2; i <= 7; i++) {
    const v = t?.[`idLeague${i}`];
    if (v) ids.add(String(v));
  }
  return Array.from(ids);
}

async function eventsFromSeason(teamId: string, leagueId: string): Promise<any[]> {
  for (const s of currentSeasons()) {
    const j = await tsdb(`/eventsseason.php?id=${leagueId}&s=${s}`);
    const list: any[] = j?.events || [];
    const mine = list.filter((e) => String(e?.idHomeTeam) === teamId || String(e?.idAwayTeam) === teamId);
    if (mine.length) return mine;
  }
  return [];
}

async function lastEvents(teamId: string): Promise<any[]> {
  const cached = lastEventsCache.get(teamId);
  if (cached && Date.now() - cached.ts < TTL) return cached.data;

  // 1) Base: últimos eventos diretos
  const base = await lastEventsBase(teamId);
  const merged = new Map<string, any>();
  for (const e of base) if (e?.idEvent) merged.set(String(e.idEvent), e);

  let playedCount = Array.from(merged.values()).filter(isPlayed).length;

  // 2) Fallback: se <5 jogados, busca temporada das ligas do time
  if (playedCount < 5) {
    try {
      const leagues = await teamLeagues(teamId);
      for (const lid of leagues) {
        if (playedCount >= 5) break;
        const evs = await eventsFromSeason(teamId, lid);
        for (const e of evs) {
          if (e?.idEvent) merged.set(String(e.idEvent), e);
        }
        playedCount = Array.from(merged.values()).filter(isPlayed).length;
      }
    } catch (e) {
      console.warn("[team-form] season fallback error", String(e));
    }
  }

  const out = Array.from(merged.values());
  lastEventsCache.set(teamId, { ts: Date.now(), data: out });
  return out;
}

function summarize(teamId: string, evts: any[]) {
  const played = evts.filter(isPlayed).sort((a, b) => {
    const da = new Date(a?.dateEvent || 0).getTime();
    const db = new Date(b?.dateEvent || 0).getTime();
    return db - da;
  });
  const last5 = played.slice(0, 5);
  const gf: number[] = [];
  const ga: number[] = [];
  const recentResults: Array<{ result: "W" | "D" | "L"; gf: number; ga: number; opp: string; date: string }> = [];
  for (const e of last5) {
    const hs = Number(e?.intHomeScore);
    const as = Number(e?.intAwayScore);
    const isHome = String(e?.idHomeTeam) === String(teamId);
    const f = isHome ? hs : as;
    const a = isHome ? as : hs;
    gf.push(f);
    ga.push(a);
    recentResults.push({
      result: f > a ? "W" : f < a ? "L" : "D",
      gf: f,
      ga: a,
      opp: String((isHome ? e?.strAwayTeam : e?.strHomeTeam) || ""),
      date: String(e?.dateEvent || ""),
    });
  }
  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  return {
    games: gf.length,
    goalsForAvg: Number(avg(gf).toFixed(2)),
    goalsAgainstAvg: Number(avg(ga).toFixed(2)),
    recentGoalsFor: gf,
    recentGoalsAgainst: ga,
    recentResults,
  };
}

async function formFor(name: string) {
  const id = await resolveTeamId(name);
  if (!id) return { games: 0, goalsForAvg: 0, goalsAgainstAvg: 0, recentGoalsFor: [], recentGoalsAgainst: [], recentResults: [], teamId: null };
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
