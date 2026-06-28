// team-form: Últimos 5 jogos por time.
// Estratégia auditada (sem APIs pagas):
//   1) Football-Data.org (TIER_ONE) — endpoint /v4/teams/{id}/matches devolve
//      até dezenas de jogos com placar. Cobertura: PL, BSA, CL, EC, FL1, BL1,
//      SA, DED, PPL, PD, WC, ELC. É a única fonte free que entrega 5 jogos
//      reais e detalhados.
//   2) TheSportsDB free (chave 123) — /eventslast.php devolve apenas 1 jogo
//      no tier free, mas serve de complemento para ligas/seleções fora do
//      escopo TIER_ONE da FDO.
//   3) União ordenada (desc) e deduplicada por (data + adversário).
//
// Body: { home: string; away: string }
// Resp: { ok, home: SideForm, away: SideForm }

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const TSDB_BASE = 'https://www.thesportsdb.com/api/v1/json/123';
const FDO_BASE = 'https://api.football-data.org/v4';
const FDO_KEY = Deno.env.get('FOOTBALL_DATA_ORG_KEY') || '';

const SUPA_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPA_SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const supa = SUPA_URL && SUPA_SRV ? createClient(SUPA_URL, SUPA_SRV) : null;

const FDO_INDEX_KEY = 'fdo_team_index_v1';
const FDO_INDEX_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 dias

// === Caches em memória (instância warm) ===
const tsdbTeamId = new Map<string, string>();
const tsdbEventsLast = new Map<string, { ts: number; data: any[] }>();
const fdoTeamId = new Map<string, number | null>(); // null = já tentamos e não há
const fdoMatchesCache = new Map<number, { ts: number; data: any[] }>();
const TTL = 1000 * 60 * 60 * 6;

function normalize(name: string): string {
  return String(name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(fc|cf|sc|ac|afc|cfc|club|clube|de|do|da|islands)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// PT → EN
const TEAM_ALIASES: Record<string, string> = {
  'argelia': 'Algeria', 'inglaterra': 'England', 'jordania': 'Jordan',
  'colombia': 'Colombia', 'rd congo': 'DR Congo',
  'republica democratica do congo': 'DR Congo', 'uzbequistao': 'Uzbekistan',
  'gana': 'Ghana', 'panama': 'Panama', 'croacia': 'Croatia',
  'alemanha': 'Germany', 'espanha': 'Spain', 'italia': 'Italy',
  'franca': 'France', 'paises baixos': 'Netherlands', 'holanda': 'Netherlands',
  'belgica': 'Belgium', 'suica': 'Switzerland', 'suecia': 'Sweden',
  'dinamarca': 'Denmark', 'polonia': 'Poland', 'marrocos': 'Morocco',
  'egito': 'Egypt', 'japao': 'Japan', 'coreia do sul': 'South Korea',
  'estados unidos': 'United States', 'eua': 'United States',
  'arabia saudita': 'Saudi Arabia', 'cabo verde': 'Cape Verde',
  'costa do marfim': 'Ivory Coast', 'camaroes': 'Cameroon',
  'senegal': 'Senegal', 'tunisia': 'Tunisia', 'nigeria': 'Nigeria',
  'africa do sul': 'South Africa', 'austria': 'Austria', 'turquia': 'Turkey',
  'russia': 'Russia', 'ucrania': 'Ukraine', 'servia': 'Serbia',
  'romenia': 'Romania', 'grecia': 'Greece', 'irlanda': 'Republic of Ireland',
  'irlanda do norte': 'Northern Ireland', 'pais de gales': 'Wales',
  'escocia': 'Scotland', 'chequia': 'Czech Republic',
  'republica tcheca': 'Czech Republic', 'eslovaquia': 'Slovakia',
  'eslovenia': 'Slovenia', 'hungria': 'Hungary', 'noruega': 'Norway',
  'finlandia': 'Finland', 'islandia': 'Iceland', 'mexico': 'Mexico',
  'paraguai': 'Paraguay', 'uruguai': 'Uruguay', 'equador': 'Ecuador',
  'venezuela': 'Venezuela', 'peru': 'Peru', 'chile': 'Chile',
  'bolivia': 'Bolivia', 'australia': 'Australia', 'nova zelandia': 'New Zealand',
  'ira': 'Iran', 'iraque': 'Iraq', 'catar': 'Qatar',
  'emirados arabes': 'United Arab Emirates', 'china': 'China PR',
  'coreia do norte': 'North Korea', 'estonia': 'Estonia',
  'letonia': 'Latvia', 'lituania': 'Lithuania',
};

function variants(name: string): string[] {
  const k = normalize(name);
  const alias = TEAM_ALIASES[k];
  return Array.from(new Set([name.trim(), alias, k].filter(Boolean) as string[]));
}

// =====================================================
// FDO — Football-Data.org
// =====================================================
let fdoTeamIndex: Map<string, number> | null = null;
let fdoTeamIndexTs = 0;
let fdoIndexBuilding: Promise<void> | null = null;

// FDO free: 10 req/min. Mantemos 7s entre chamadas para ficar abaixo do limite.
const FDO_THROTTLE_MS = 7000;
let fdoLastCall = 0;
async function fdo(path: string, params?: Record<string, string>): Promise<any | null> {
  if (!FDO_KEY) return null;
  const wait = Math.max(0, fdoLastCall + FDO_THROTTLE_MS - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  fdoLastCall = Date.now();
  const url = new URL(FDO_BASE + path);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(url.toString(), {
      headers: { 'X-Auth-Token': FDO_KEY, 'Accept': 'application/json' },
      signal: ctrl.signal,
    });
    clearTimeout(to);
    if (!res.ok) {
      console.warn(`[team-form] FDO ${path} -> ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn('[team-form] fdo error', path, String(e));
    return null;
  }
}

// Constrói o índice usando /v4/teams paginado (500 por página). Sequencial
// com throttle para respeitar o limite de 10 req/min do plano free.
async function fetchFdoIndexFromApi(): Promise<Map<string, number>> {
  const idx = new Map<string, number>();
  let offset = 0;
  const pageSize = 500;
  const maxPages = 8;
  for (let p = 0; p < maxPages; p++) {
    const r = await fdo('/teams', { limit: String(pageSize), offset: String(offset) });
    const teams: any[] = r?.teams || [];
    if (!teams.length) break;
    for (const t of teams) {
      const id = Number(t?.id);
      if (!id) continue;
      for (const n of [t.name, t.shortName, t.tla].filter(Boolean)) {
        const k = normalize(String(n));
        if (k && !idx.has(k)) idx.set(k, id);
      }
    }
    if (teams.length < pageSize) break;
    offset += pageSize;
  }
  return idx;
}

async function loadFdoIndexFromKv(): Promise<{ idx: Map<string, number>; updatedAt: number } | null> {
  if (!supa) return null;
  try {
    const { data, error } = await supa.from('team_form_kv').select('value, updated_at').eq('key', FDO_INDEX_KEY).maybeSingle();
    if (error || !data) return null;
    const entries: [string, number][] = (data.value as any)?.entries || [];
    return { idx: new Map(entries), updatedAt: new Date(data.updated_at as any).getTime() };
  } catch (e) { console.warn('[team-form] kv load failed', String(e)); return null; }
}

async function saveFdoIndexToKv(idx: Map<string, number>) {
  if (!supa) return;
  try {
    const entries = Array.from(idx.entries());
    const { error } = await supa.from('team_form_kv').upsert({
      key: FDO_INDEX_KEY,
      value: { entries, size: entries.length },
      updated_at: new Date().toISOString(),
    });
    if (error) console.warn('[team-form] kv save error', error.message);
    else console.log(`[team-form] kv saved (${entries.length} keys)`);
  } catch (e) { console.warn('[team-form] kv save failed', String(e)); }
}

async function doBuildFdoIndex(): Promise<void> {
  // 1) tenta KV
  const fromKv = await loadFdoIndexFromKv();
  if (fromKv && Date.now() - fromKv.updatedAt < FDO_INDEX_TTL_MS && fromKv.idx.size > 0) {
    fdoTeamIndex = fromKv.idx;
    fdoTeamIndexTs = fromKv.updatedAt;
    console.log(`[team-form] FDO index loaded from KV: ${fromKv.idx.size} keys`);
    return;
  }
  // 2) reconstroi da API e persiste
  const idx = await fetchFdoIndexFromApi();
  fdoTeamIndex = idx;
  fdoTeamIndexTs = Date.now();
  console.log(`[team-form] FDO index built from API: ${idx.size} keys`);
  if (idx.size > 0) await saveFdoIndexToKv(idx);
}

function ensureFdoIndex(): Promise<void> {
  if (fdoTeamIndex && Date.now() - fdoTeamIndexTs < FDO_INDEX_TTL_MS) return Promise.resolve();
  if (!fdoIndexBuilding) {
    fdoIndexBuilding = doBuildFdoIndex().catch((e) => {
      console.warn('[team-form] index build failed', String(e));
    }).finally(() => { fdoIndexBuilding = null; });
  }
  return fdoIndexBuilding;
}

async function resolveFdoTeamId(name: string, waitMs = 0): Promise<number | null> {
  const k = normalize(name);
  if (!k) return null;
  if (fdoTeamId.has(k)) return fdoTeamId.get(k)!;
  // dispara build em background; aguarda no máximo `waitMs` se ainda não pronto
  const buildP = ensureFdoIndex();
  if (!fdoTeamIndex && waitMs > 0) {
    await Promise.race([buildP, new Promise((r) => setTimeout(r, waitMs))]);
  }
  const idx = fdoTeamIndex;
  if (!idx) return null;
  for (const v of variants(name)) {
    const nv = normalize(v);
    if (idx.has(nv)) { const id = idx.get(nv)!; fdoTeamId.set(k, id); return id; }
  }
  for (const v of variants(name)) {
    const nv = normalize(v);
    for (const [key, id] of idx) {
      if (key.includes(nv) || nv.includes(key)) { fdoTeamId.set(k, id); return id; }
    }
  }
  fdoTeamId.set(k, null);
  return null;
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function fdoMatches(teamId: number): Promise<any[]> {
  const cached = fdoMatchesCache.get(teamId);
  if (cached && Date.now() - cached.ts < TTL) return cached.data;
  const today = new Date().toISOString().slice(0, 10);
  const r = await fdo(`/teams/${teamId}/matches`, {
    dateFrom: isoDaysAgo(365),
    dateTo: today,
    status: 'FINISHED',
  });
  const matches: any[] = r?.matches || [];
  fdoMatchesCache.set(teamId, { ts: Date.now(), data: matches });
  return matches;
}

function fdoToCommon(m: any, teamId: number) {
  const isHome = Number(m?.homeTeam?.id) === teamId;
  const hs = Number(m?.score?.fullTime?.home);
  const as = Number(m?.score?.fullTime?.away);
  if (!Number.isFinite(hs) || !Number.isFinite(as)) return null;
  return {
    date: String(m?.utcDate || '').slice(0, 10),
    isHome,
    homeName: String(m?.homeTeam?.name || ''),
    awayName: String(m?.awayTeam?.name || ''),
    hs, as,
  };
}

// =====================================================
// TSDB — fallback
// =====================================================
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

async function resolveTsdbId(name: string): Promise<string | null> {
  const k = normalize(name);
  if (!k) return null;
  if (tsdbTeamId.has(k)) return tsdbTeamId.get(k)!;
  let fallback: any = null;
  for (const q of variants(name)) {
    const j = await tsdb(`/searchteams.php?t=${encodeURIComponent(q)}`);
    const teams: any[] = j?.teams || [];
    const soccer = teams.filter((t) => /soccer|football/i.test(t?.strSport || ''));
    if (!fallback && teams[0]) fallback = teams[0];
    if (!soccer.length) continue;
    const pick = soccer.find((t) => normalize(t?.strTeam || '') === normalize(q)) ||
                 soccer.find((t) => normalize(t?.strTeam || '').includes(k)) ||
                 soccer[0];
    if (pick?.idTeam) { tsdbTeamId.set(k, pick.idTeam); return pick.idTeam; }
  }
  if (fallback?.idTeam) { tsdbTeamId.set(k, fallback.idTeam); return fallback.idTeam; }
  return null;
}

async function tsdbLastEvents(teamId: string): Promise<any[]> {
  const cached = tsdbEventsLast.get(teamId);
  if (cached && Date.now() - cached.ts < TTL) return cached.data;
  const j = await tsdb(`/eventslast.php?id=${teamId}`);
  const out: any[] = j?.results || [];
  tsdbEventsLast.set(teamId, { ts: Date.now(), data: out });
  return out;
}

function tsdbToCommon(e: any, teamId: string) {
  const hs = Number(e?.intHomeScore);
  const as = Number(e?.intAwayScore);
  if (!Number.isFinite(hs) || !Number.isFinite(as)) return null;
  const isHome = String(e?.idHomeTeam) === String(teamId);
  return {
    date: String(e?.dateEvent || ''),
    isHome,
    homeName: String(e?.strHomeTeam || ''),
    awayName: String(e?.strAwayTeam || ''),
    hs, as,
  };
}

// =====================================================
// Agregação
// =====================================================
function summarize(common: Array<{ date: string; isHome: boolean; homeName: string; awayName: string; hs: number; as: number }>) {
  // dedup por (data + adversário)
  const map = new Map<string, typeof common[number]>();
  for (const c of common) {
    const opp = c.isHome ? c.awayName : c.homeName;
    const key = `${c.date}|${normalize(opp)}`;
    if (!map.has(key)) map.set(key, c);
  }
  const sorted = Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  const last5 = sorted.slice(0, 5);
  const gf: number[] = [];
  const ga: number[] = [];
  const recentResults: Array<{ result: 'W' | 'D' | 'L'; gf: number; ga: number; opp: string; date: string }> = [];
  for (const c of last5) {
    const f = c.isHome ? c.hs : c.as;
    const a = c.isHome ? c.as : c.hs;
    gf.push(f); ga.push(a);
    recentResults.push({
      result: f > a ? 'W' : f < a ? 'L' : 'D',
      gf: f, ga: a,
      opp: c.isHome ? c.awayName : c.homeName,
      date: c.date,
    });
  }
  const avg = (arr: number[]) => arr.length ? arr.reduce((x, y) => x + y, 0) / arr.length : 0;
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
  const collected: Array<{ date: string; isHome: boolean; homeName: string; awayName: string; hs: number; as: number }> = [];
  let sourceFdo = 0, sourceTsdb = 0;

  // 1) FDO — espera até 5s pela carga do índice (KV é rápido, ~300ms)
  const fdoId = await resolveFdoTeamId(name, 5000);
  if (fdoId) {
    const matches = await fdoMatches(fdoId);
    for (const m of matches) {
      const c = fdoToCommon(m, fdoId);
      if (c) { collected.push(c); sourceFdo++; }
    }
  }

  // 2) TSDB (complemento)
  if (collected.length < 5) {
    const tid = await resolveTsdbId(name);
    if (tid) {
      const evts = await tsdbLastEvents(tid);
      for (const e of evts) {
        const c = tsdbToCommon(e, tid);
        if (c) { collected.push(c); sourceTsdb++; }
      }
    }
  }

  console.log(`[team-form] "${name}" fdoId=${fdoId} fdo=${sourceFdo} tsdb=${sourceTsdb} total=${collected.length}`);
  const s = summarize(collected);
  return { ...s, sources: { fdo: sourceFdo, tsdb: sourceTsdb } };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    // Endpoint admin: força reconstrução completa do índice FDO via API.
    // Uso: POST /functions/v1/team-form?build=1
    if (url.searchParams.get('build') === '1') {
      fdoTeamIndex = null; fdoTeamIndexTs = 0;
      const idx = await fetchFdoIndexFromApi();
      fdoTeamIndex = idx; fdoTeamIndexTs = Date.now();
      if (idx.size > 0) await saveFdoIndexToKv(idx);
      return new Response(JSON.stringify({ ok: true, built: true, size: idx.size }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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
