// team-form: Últimos 5 jogos por time via Football-Data.org (FDO).
//
// Estratégia:
//  1. Mantém em memória um mapa <nomeNormalizado, idFDO> populado sob
//     demanda a partir das ligas grátis do FDO (PL, BL1, FL1, SA, PD,
//     DED, PPL, BSA, CL, WC, EC).
//  2. Para cada time da request, busca seus jogos finalizados nos
//     últimos ~240 dias e devolve agregados dos 5 mais recentes.
//
// Body: { home: string; away: string }
// Resp: { ok, home: SideForm, away: SideForm }

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const FD_KEY = Deno.env.get('FOOTBALL_DATA_ORG_KEY') || '';
const FD_BASE = 'https://api.football-data.org/v4';

const COMP_CODES = ['PL', 'BL1', 'FL1', 'SA', 'PD', 'DED', 'PPL', 'BSA', 'CL', 'EC', 'WC', 'ELC', 'CLI', 'PD2', 'SA2', 'BL2'];

// Cache em memória (vive enquanto a instância do worker estiver quente)
const teamIdByName = new Map<string, number>();
const compFetched = new Set<string>();
const matchesCache = new Map<number, { ts: number; data: any[] }>();
const TTL_MATCHES = 1000 * 60 * 60 * 6; // 6h

function normalize(name: string): string {
  return String(name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function fd(path: string): Promise<any | null> {
  if (!FD_KEY) { console.warn('[team-form] no FD_KEY'); return null; }
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(FD_BASE + path, {
      headers: { 'X-Auth-Token': FD_KEY, 'Accept': 'application/json' },
      signal: ctrl.signal,
    });
    clearTimeout(to);
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.warn(`[team-form] FD ${path} -> ${res.status} ${txt.slice(0, 150)}`);
      return null;
    }
    return await res.json().catch(() => null);
  } catch (e) { console.warn('[team-form] fd error', path, e); return null; }
}

async function loadCompetitionTeams(code: string) {
  if (compFetched.has(code)) return;
  compFetched.add(code);
  const j = await fd(`/competitions/${code}/teams`);
  const teams: any[] = j?.teams || [];
  for (const t of teams) {
    if (!t?.id) continue;
    const names = [t.name, t.shortName, t.tla].filter(Boolean);
    for (const n of names) {
      const k = normalize(n);
      if (k && !teamIdByName.has(k)) teamIdByName.set(k, t.id);
    }
  }
}

async function resolveTeamId(name: string): Promise<number | null> {
  const k = normalize(name);
  if (!k) return null;
  if (teamIdByName.has(k)) return teamIdByName.get(k)!;
  // Tenta carregar competições uma por uma até achar
  for (const code of COMP_CODES) {
    if (!compFetched.has(code)) {
      await loadCompetitionTeams(code);
      if (teamIdByName.has(k)) return teamIdByName.get(k)!;
    }
  }
  // Match por substring se ainda não bateu
  for (const [stored, id] of teamIdByName.entries()) {
    if (stored.length >= 4 && (stored.includes(k) || k.includes(stored))) return id;
  }
  return null;
}

async function lastMatchesFor(teamId: number): Promise<any[]> {
  const cached = matchesCache.get(teamId);
  if (cached && Date.now() - cached.ts < TTL_MATCHES) return cached.data;
  const now = new Date();
  const dateTo = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - 240 * 24 * 60 * 60 * 1000);
  const dateFrom = from.toISOString().slice(0, 10);
  const j = await fd(`/teams/${teamId}/matches?status=FINISHED&dateFrom=${dateFrom}&dateTo=${dateTo}`);
  const matches: any[] = j?.matches || [];
  matchesCache.set(teamId, { ts: Date.now(), data: matches });
  return matches;
}

function summarize(teamId: number, matches: any[]) {
  // Mais recentes primeiro
  const sorted = [...matches].sort((a, b) => new Date(b.utcDate).getTime() - new Date(a.utcDate).getTime());
  const last5 = sorted.slice(0, 5);
  const gf: number[] = [];
  const ga: number[] = [];
  for (const m of last5) {
    const hs = m?.score?.fullTime?.home;
    const as = m?.score?.fullTime?.away;
    if (typeof hs !== 'number' || typeof as !== 'number') continue;
    const isHome = m?.homeTeam?.id === teamId;
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
  const matches = await lastMatchesFor(id);
  return { ...summarize(id, matches), teamId: id };
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
