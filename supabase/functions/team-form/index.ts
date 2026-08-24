// team-form: Últimos 5 jogos por time.
//
// Estratégia auditada (sem APIs pagas), em ordem de prioridade:
//   1) ESPN public API (site.web.api.espn.com)
//      - common/v3/search?query=...  → resolve nome → { id, defaultLeagueSlug }
//      - site/v2/sports/soccer/{slug}/teams/{id}/schedule?season=YYYY&seasontype=1
//      - Retorna 30+ jogos por temporada para clubes e jogos jogados de seleções.
//      - Sem auth, sem rate limit documentado. Cobertura global.
//   2) TheSportsDB free (chave 123) — /eventslast.php devolve 1 jogo no tier
//      free; serve apenas como complemento.
//   3) Football-Data.org está desativada (conta retornando 403
//      "Your account has been disabled."), mantida apenas como código morto e
//      protegida por flag (FDO_ENABLED=false) para reativação futura.
//
// Body: { home: string; away: string }
// Resp: { ok, home: SideForm, away: SideForm }

import { corsHeaders } from '../_shared/cors.ts';

const TSDB_BASE = 'https://www.thesportsdb.com/api/v1/json/123';
const ESPN_BASE = 'https://site.web.api.espn.com';
const ESPN_UA = 'Mozilla/5.0 (compatible; Lovable/1.0)';

// === Caches em memória (instância warm) ===
const tsdbTeamId = new Map<string, string>();
const tsdbEventsLast = new Map<string, { ts: number; data: any[] }>();
const espnTeamCache = new Map<string, { id: string; slug: string } | null>();
const espnScheduleCache = new Map<string, { ts: number; data: any[] }>();
const TTL = 1000 * 60 * 60 * 6;

function normalize(name: string): string {
  return String(name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(fc|cf|sc|ac|afc|cfc|club|clube|de|do|da|islands)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// PT → EN (mantido para seleções nacionais — ESPN aceita PT em vários
// casos, mas EN melhora a relevância da busca)
const TEAM_ALIASES: Record<string, string> = {
  'argelia': 'Algeria', 'inglaterra': 'England', 'jordania': 'Jordan',
  'colombia': 'Colombia', 'rd congo': 'DR Congo',
  'republica democratica do congo': 'DR Congo', 'uzbequistao': 'Uzbekistan',
  'gana': 'Ghana', 'panama': 'Panama', 'croacia': 'Croatia',
  'arabia saudita': 'Saudi Arabia', 'cabo verde': 'Cape Verde',
  'estados unidos': 'United States', 'eua': 'United States', 'usa': 'United States',
  'paises baixos': 'Netherlands', 'holanda': 'Netherlands',
  'alemanha': 'Germany', 'franca': 'France', 'espanha': 'Spain',
  'italia': 'Italy', 'belgica': 'Belgium', 'suica': 'Switzerland',
  'austria': 'Austria', 'polonia': 'Poland', 'portugal': 'Portugal',
  'dinamarca': 'Denmark', 'noruega': 'Norway', 'suecia': 'Sweden',
  'turquia': 'Turkey', 'russia': 'Russia', 'ucrania': 'Ukraine',
  'republica tcheca': 'Czech Republic', 'tchequia': 'Czech Republic',
  'eslovaquia': 'Slovakia', 'eslovenia': 'Slovenia',
  'hungria': 'Hungary', 'romenia': 'Romania', 'bulgaria': 'Bulgaria',
  'grecia': 'Greece', 'irlanda': 'Ireland', 'escocia': 'Scotland',
  'pais de gales': 'Wales', 'gales': 'Wales',
  'irlanda do norte': 'Northern Ireland',
  'mexico': 'Mexico', 'canada': 'Canada', 'argentina': 'Argentina',
  'brasil': 'Brazil', 'uruguai': 'Uruguay', 'paraguai': 'Paraguay',
  'chile': 'Chile', 'peru': 'Peru', 'equador': 'Ecuador',
  'venezuela': 'Venezuela', 'bolivia': 'Bolivia',
  'coreia do sul': 'South Korea', 'coreia do norte': 'North Korea',
  'japao': 'Japan', 'china': 'China', 'australia': 'Australia',
  'nova zelandia': 'New Zealand',
  'ira': 'Iran', 'iraque': 'Iraq', 'siria': 'Syria',
  'emirados arabes unidos': 'United Arab Emirates', 'emirados': 'United Arab Emirates',
  'catar': 'Qatar', 'qatar': 'Qatar', 'kuwait': 'Kuwait',
  'oma': 'Oman', 'libano': 'Lebanon', 'palestina': 'Palestine',
  'egito': 'Egypt', 'marrocos': 'Morocco', 'tunisia': 'Tunisia',
  'senegal': 'Senegal', 'nigeria': 'Nigeria', 'camaroes': 'Cameroon',
  'costa do marfim': 'Ivory Coast', 'mali': 'Mali', 'burkina faso': 'Burkina Faso',
  'africa do sul': 'South Africa', 'angola': 'Angola', 'mocambique': 'Mozambique',
};

function variants(name: string): string[] {
  const out = new Set<string>();
  const clean = String(name || '').trim();
  if (!clean) return [];
  out.add(clean);
  const norm = normalize(clean);
  if (TEAM_ALIASES[norm]) out.add(TEAM_ALIASES[norm]);
  // remove sufixos comuns
  const stripped = clean.replace(/\s+(FC|CF|SC|AC|AFC|CFC)$/i, '').trim();
  if (stripped && stripped !== clean) out.add(stripped);
  return Array.from(out);
}

// =====================================================
// ESPN (primário)
// =====================================================
async function espn(path: string): Promise<any | null> {
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(ESPN_BASE + path, {
      headers: { 'User-Agent': ESPN_UA, 'Accept': 'application/json' },
      signal: ctrl.signal,
    });
    clearTimeout(to);
    if (!res.ok) {
      console.warn(`[team-form] ESPN ${path} -> ${res.status}`);
      return null;
    }
    return await res.json().catch(() => null);
  } catch (e) {
    console.warn('[team-form] espn error', path, String(e));
    return null;
  }
}

async function resolveEspnTeam(name: string): Promise<{ id: string; slug: string } | null> {
  const k = normalize(name);
  if (!k) return null;
  if (espnTeamCache.has(k)) return espnTeamCache.get(k)!;
  for (const q of variants(name)) {
    const j = await espn(`/apis/common/v3/search?query=${encodeURIComponent(q)}&limit=15`);
    const items: any[] = j?.items || [];
    const teams = items.filter((x) => x?.type === 'team' && x?.sport === 'soccer');
    if (!teams.length) continue;
    const target = normalize(q);
    const exact = teams.find((t) => normalize(t?.displayName || '') === target) ||
                  teams.find((t) => normalize(t?.name || '') === target) ||
                  teams.find((t) => normalize(t?.displayName || '').includes(target)) ||
                  teams[0];
    if (exact?.id && exact?.defaultLeagueSlug) {
      const out = { id: String(exact.id), slug: String(exact.defaultLeagueSlug) };
      espnTeamCache.set(k, out);
      return out;
    }
  }
  espnTeamCache.set(k, null);
  return null;
}

async function espnSchedule(slug: string, teamId: string): Promise<any[]> {
  const cacheKey = `${slug}|${teamId}`;
  const cached = espnScheduleCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < TTL) return cached.data;

  const out: any[] = [];
  const year = new Date().getUTCFullYear();
  // Sem filtro de season = temporada atual (cobre seleções com seus últimos jogos).
  // Em seguida, percorre os 2 anos anteriores para clubes que estejam fora de temporada.
  const seasons: Array<string> = [
    '', // current
    `?season=${year}&seasontype=1`,
    `?season=${year - 1}&seasontype=1`,
    `?season=${year - 2}&seasontype=1`,
  ];
  const seen = new Set<string>();
  for (const qs of seasons) {
    if (out.filter(isCompleted).length >= 10) break;
    const j = await espn(`/apis/site/v2/sports/soccer/${encodeURIComponent(slug)}/teams/${teamId}/schedule${qs}`);
    const events: any[] = j?.events || [];
    for (const e of events) {
      const id = String(e?.id || '');
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      out.push(e);
    }
  }
  espnScheduleCache.set(cacheKey, { ts: Date.now(), data: out });
  return out;
}

function isCompleted(e: any): boolean {
  const c = e?.competitions?.[0];
  return !!c?.status?.type?.completed;
}

function espnToCommon(e: any, teamId: string) {
  const comp = e?.competitions?.[0];
  if (!comp || !comp?.status?.type?.completed) return null;
  const competitors: any[] = comp?.competitors || [];
  if (competitors.length < 2) return null;
  const home = competitors.find((c) => c?.homeAway === 'home') || competitors[0];
  const away = competitors.find((c) => c?.homeAway === 'away') || competitors[1];
  const hs = Number(home?.score?.value ?? home?.score);
  const as = Number(away?.score?.value ?? away?.score);
  if (!Number.isFinite(hs) || !Number.isFinite(as)) return null;
  const isHome = String(home?.team?.id || home?.id) === String(teamId);
  return {
    date: String(e?.date || '').slice(0, 10),
    isHome,
    homeName: String(home?.team?.displayName || home?.team?.name || ''),
    awayName: String(away?.team?.displayName || away?.team?.name || ''),
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

// searchevents.php por nome — útil para seleções nacionais (free tier devolve mais resultados aqui).
async function tsdbSearchEventsByTeam(name: string): Promise<any[]> {
  const out: any[] = [];
  for (const q of variants(name)) {
    const j = await tsdb(`/searchevents.php?e=${encodeURIComponent(q)}`);
    const ev: any[] = j?.event || [];
    for (const e of ev) {
      // só eventos finalizados de futebol
      if (!/soccer|football/i.test(e?.strSport || '')) continue;
      if (e?.intHomeScore == null || e?.intAwayScore == null) continue;
      out.push(e);
    }
    if (out.length >= 10) break;
  }
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
type Common = { date: string; isHome: boolean; homeName: string; awayName: string; hs: number; as: number };

function summarize(common: Common[]) {
  // dedup por (data + adversário)
  const map = new Map<string, Common>();
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
  const collected: Common[] = [];
  let sourceEspn = 0, sourceTsdb = 0;

  // 1) ESPN (primário)
  const t = await resolveEspnTeam(name);
  if (t) {
    const events = await espnSchedule(t.slug, t.id);
    for (const e of events) {
      const c = espnToCommon(e, t.id);
      if (c) { collected.push(c); sourceEspn++; }
    }
  }

  // 2) TSDB (complemento se ainda faltar)
  let sourceTsdbSearch = 0;
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

  // 3) TSDB searchevents por nome — cobre seleções com poucos jogos no eventslast
  if (collected.length < 5) {
    const evts = await tsdbSearchEventsByTeam(name);
    const target = normalize(variants(name)[1] || name);
    for (const e of evts) {
      const homeName = String(e?.strHomeTeam || '');
      const awayName = String(e?.strAwayTeam || '');
      const hn = normalize(homeName);
      const an = normalize(awayName);
      const isHome = hn.includes(target) || target.includes(hn);
      const isAway = an.includes(target) || target.includes(an);
      if (!isHome && !isAway) continue;
      const hs = Number(e?.intHomeScore);
      const as_ = Number(e?.intAwayScore);
      if (!Number.isFinite(hs) || !Number.isFinite(as_)) continue;
      collected.push({
        date: String(e?.dateEvent || ''),
        isHome, homeName, awayName, hs, as: as_,
      });
      sourceTsdbSearch++;
    }
  }

  console.log(`[team-form] "${name}" espn=${sourceEspn} tsdb=${sourceTsdb} tsdbSearch=${sourceTsdbSearch} total=${collected.length}`);
  const s = summarize(collected);
  return { ...s, sources: { espn: sourceEspn, tsdb: sourceTsdb, tsdbSearch: sourceTsdbSearch } };
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
