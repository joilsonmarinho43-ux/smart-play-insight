// ════════════════════════════════════════════════════════════════
// match-stats-resolver
// Cascata: cache_api → match_stats_fallback (banco) → API-Football
// → TheSportsDB → histórico (qualquer idade). Nunca inventa dados.
// Retorna sempre { stats, source, confidence_score, lowConfidence, missing[] }
// ════════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// TTLs em segundos
const TTL = {
  day: 6 * 3600,           // jogos do dia
  standings: 24 * 3600,    // classificação
  team_stats: 7 * 86400,   // estatísticas históricas
  h2h: 30 * 86400,         // H2H
};

// Campos do schema padrão (usados no cálculo de confidence)
const STAT_FIELDS = [
  "avg_goals", "avg_corners", "btts_pct",
  "over05_pct", "over15_pct", "over25_pct", "over35_pct",
  "clean_sheets_pct", "home_form", "away_form",
] as const;

type Stats = {
  avg_goals: number | null;
  avg_corners: number | null;
  btts_pct: number | null;
  over05_pct: number | null;
  over15_pct: number | null;
  over25_pct: number | null;
  over35_pct: number | null;
  clean_sheets_pct: number | null;
  home_form: string | null;
  away_form: string | null;
  h2h: any[] | null;
};

function emptyStats(): Stats {
  return {
    avg_goals: null, avg_corners: null, btts_pct: null,
    over05_pct: null, over15_pct: null, over25_pct: null, over35_pct: null,
    clean_sheets_pct: null, home_form: null, away_form: null, h2h: null,
  };
}

function sb() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

function fieldsFilled(s: Stats): number {
  return STAT_FIELDS.filter((k) => s[k] !== null && s[k] !== undefined).length;
}

function computeConfidence(s: Stats, source: string): number {
  const filled = fieldsFilled(s);
  const total = STAT_FIELDS.length;
  const ratio = filled / total; // 0..1
  const weight =
    source === "api-football" ? 100 :
    source === "thesportsdb"  ? 90  :
    source === "mixed"        ? 80  :
    source === "historical"   ? 70  : 50;
  // Confidence = peso × cobertura, mínimo 40
  return Math.max(40, Math.round(weight * (0.5 + 0.5 * ratio)));
}

function missingFields(s: Stats): string[] {
  return STAT_FIELDS.filter((k) => s[k] === null || s[k] === undefined);
}

// ── Cache_api helpers ────────────────────────────────────────────
async function cacheGet(key: string, ttlSec: number): Promise<any | null> {
  try {
    const { data } = await sb()
      .from("cache_api")
      .select("dados_json, ultima_atualizacao")
      .eq("cache_key", key)
      .maybeSingle();
    if (!data) return null;
    const ageSec = (Date.now() - new Date(data.ultima_atualizacao).getTime()) / 1000;
    if (ageSec > ttlSec) return null;
    return data.dados_json;
  } catch { return null; }
}
async function cacheSet(key: string, value: any) {
  try {
    await sb().from("cache_api").upsert({
      cache_key: key, dados_json: value, status_jogo: "STATS",
      ultima_atualizacao: new Date().toISOString(),
    });
  } catch (e) { console.error("cacheSet", e); }
}

// ── TheSportsDB ──────────────────────────────────────────────────
async function tsdbFetch(url: string, timeoutMs = 6000): Promise<any | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    return await r.json();
  } catch { clearTimeout(t); return null; }
}

async function tsdbFindTeam(name: string): Promise<string | null> {
  const cacheKey = `tsdb_team_${name.toLowerCase()}`;
  const cached = await cacheGet(cacheKey, 30 * 86400);
  if (cached?.teamId) return cached.teamId as string;
  const j = await tsdbFetch(
    `https://www.thesportsdb.com/api/v1/json/123/searchteams.php?t=${encodeURIComponent(name)}`,
  );
  const team = j?.teams?.find((t: any) => /soccer/i.test(t?.strSport)) || j?.teams?.[0];
  if (!team?.idTeam) return null;
  await cacheSet(cacheKey, { teamId: team.idTeam });
  return team.idTeam as string;
}

async function tsdbLastEvents(teamId: string): Promise<any[]> {
  const cacheKey = `tsdb_last_${teamId}`;
  const cached = await cacheGet(cacheKey, TTL.team_stats);
  if (cached?.events) return cached.events;
  const j = await tsdbFetch(
    `https://www.thesportsdb.com/api/v1/json/123/eventslast.php?id=${teamId}`,
  );
  const events: any[] = j?.results || [];
  await cacheSet(cacheKey, { events });
  return events;
}

function formAndGoals(events: any[], teamId: string) {
  // Últimos 5 — calcula forma e médias
  const slice = events.slice(0, 5);
  let form = "";
  let totalGoals = 0;
  let bttsCount = 0;
  let over15 = 0, over25 = 0, over35 = 0, over05 = 0, cleanSheets = 0;
  let counted = 0;

  for (const ev of slice) {
    const hId = String(ev.idHomeTeam);
    const isHome = hId === teamId;
    const gh = Number(ev.intHomeScore);
    const ga = Number(ev.intAwayScore);
    if (Number.isNaN(gh) || Number.isNaN(ga)) continue;
    counted++;
    const my = isHome ? gh : ga;
    const opp = isHome ? ga : gh;
    if (my > opp) form += "W";
    else if (my === opp) form += "D";
    else form += "L";
    const total = gh + ga;
    totalGoals += total;
    if (gh > 0 && ga > 0) bttsCount++;
    if (total > 0) over05++;
    if (total > 1) over15++;
    if (total > 2) over25++;
    if (total > 3) over35++;
    if (opp === 0) cleanSheets++;
  }
  if (counted === 0) return null;
  return {
    form,
    avgGoals: totalGoals / counted,
    btts: (bttsCount / counted) * 100,
    over05: (over05 / counted) * 100,
    over15: (over15 / counted) * 100,
    over25: (over25 / counted) * 100,
    over35: (over35 / counted) * 100,
    cleanSheets: (cleanSheets / counted) * 100,
  };
}

async function tsdbH2H(homeId: string, awayId: string): Promise<any[] | null> {
  const cacheKey = `tsdb_h2h_${homeId}_${awayId}`;
  const cached = await cacheGet(cacheKey, TTL.h2h);
  if (cached?.events) return cached.events;
  const j = await tsdbFetch(
    `https://www.thesportsdb.com/api/v1/json/123/eventsh2h.php?id=${homeId}vs${awayId}`,
  );
  const events: any[] = j?.event || [];
  const slim = events.slice(0, 10).map((e: any) => ({
    date: e.dateEvent, home: e.strHomeTeam, away: e.strAwayTeam,
    score: `${e.intHomeScore ?? "-"}-${e.intAwayScore ?? "-"}`,
  }));
  await cacheSet(cacheKey, { events: slim });
  return slim;
}

async function fromTheSportsDB(home: string, away: string): Promise<Stats | null> {
  const [homeId, awayId] = await Promise.all([
    tsdbFindTeam(home),
    tsdbFindTeam(away),
  ]);
  if (!homeId && !awayId) return null;

  const stats = emptyStats();

  if (homeId) {
    const ev = await tsdbLastEvents(homeId);
    const r = formAndGoals(ev, homeId);
    if (r) {
      stats.home_form = r.form;
      stats.avg_goals = r.avgGoals;
      stats.btts_pct = r.btts;
      stats.over05_pct = r.over05;
      stats.over15_pct = r.over15;
      stats.over25_pct = r.over25;
      stats.over35_pct = r.over35;
      stats.clean_sheets_pct = r.cleanSheets;
    }
  }
  if (awayId) {
    const ev = await tsdbLastEvents(awayId);
    const r = formAndGoals(ev, awayId);
    if (r) {
      stats.away_form = r.form;
      // Média entre os dois lados se já existir
      if (stats.avg_goals !== null) {
        stats.avg_goals = (stats.avg_goals + r.avgGoals) / 2;
        stats.btts_pct = ((stats.btts_pct ?? 0) + r.btts) / 2;
        stats.over05_pct = ((stats.over05_pct ?? 0) + r.over05) / 2;
        stats.over15_pct = ((stats.over15_pct ?? 0) + r.over15) / 2;
        stats.over25_pct = ((stats.over25_pct ?? 0) + r.over25) / 2;
        stats.over35_pct = ((stats.over35_pct ?? 0) + r.over35) / 2;
        stats.clean_sheets_pct = ((stats.clean_sheets_pct ?? 0) + r.cleanSheets) / 2;
      } else {
        stats.avg_goals = r.avgGoals;
        stats.btts_pct = r.btts;
        stats.over05_pct = r.over05;
        stats.over15_pct = r.over15;
        stats.over25_pct = r.over25;
        stats.over35_pct = r.over35;
        stats.clean_sheets_pct = r.cleanSheets;
      }
    }
  }
  if (homeId && awayId) {
    stats.h2h = await tsdbH2H(homeId, awayId);
  }
  return fieldsFilled(stats) > 0 ? stats : null;
}

// ── SportsRC v2 (prioridade 1) ───────────────────────────────────
const SPORTSRC_KEY = Deno.env.get("SPORTSRC_API_KEY") || "";

async function sportsrcFetch(type: string, id?: string): Promise<any | null> {
  if (!SPORTSRC_KEY) return null;
  const url = new URL("https://api.sportsrc.org/v2/");
  url.searchParams.set("type", type);
  if (id) url.searchParams.set("id", id);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url.toString(), {
      headers: { "X-API-KEY": SPORTSRC_KEY, "Accept": "application/json" },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok) return null;
    return await r.json();
  } catch { clearTimeout(t); return null; }
}

function aggregateFromMatches(list: any[], teamName: string) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const slice = list.slice(0, 5);
  let form = ""; let totalGoals = 0; let counted = 0;
  let btts = 0, o05 = 0, o15 = 0, o25 = 0, o35 = 0, cs = 0;
  for (const ev of slice) {
    const home = ev?.teams?.home?.name || ev?.home || "";
    const away = ev?.teams?.away?.name || ev?.away || "";
    const gh = Number(ev?.score?.current?.home ?? ev?.score?.home ?? NaN);
    const ga = Number(ev?.score?.current?.away ?? ev?.score?.away ?? NaN);
    if (Number.isNaN(gh) || Number.isNaN(ga)) continue;
    const isHome = String(home).toLowerCase() === teamName.toLowerCase();
    const isAway = String(away).toLowerCase() === teamName.toLowerCase();
    if (!isHome && !isAway) continue;
    counted++;
    const my = isHome ? gh : ga; const opp = isHome ? ga : gh;
    form += my > opp ? "W" : my === opp ? "D" : "L";
    const tot = gh + ga; totalGoals += tot;
    if (gh > 0 && ga > 0) btts++;
    if (tot > 0) o05++; if (tot > 1) o15++; if (tot > 2) o25++; if (tot > 3) o35++;
    if (opp === 0) cs++;
  }
  if (counted === 0) return null;
  return {
    form, avgGoals: totalGoals / counted,
    btts: (btts / counted) * 100,
    over05: (o05 / counted) * 100, over15: (o15 / counted) * 100,
    over25: (o25 / counted) * 100, over35: (o35 / counted) * 100,
    cleanSheets: (cs / counted) * 100,
  };
}

async function fromSportsRC(matchId: string, home: string, away: string): Promise<Stats | null> {
  // matchId pode vir prefixado pelo front (srcv2-<id>) ou cru.
  const rawId = matchId.replace(/^srcv2-/, "");
  const [lastJ, h2hJ] = await Promise.all([
    sportsrcFetch("last_matches", rawId),
    sportsrcFetch("h2h", rawId),
  ]);
  if (!lastJ && !h2hJ) return null;
  const stats = emptyStats();

  // last_matches geralmente devolve { data: { home: [...], away: [...] } } ou listas planas
  const lastHome = lastJ?.data?.home || lastJ?.data?.last_home || [];
  const lastAway = lastJ?.data?.away || lastJ?.data?.last_away || [];
  const flat = Array.isArray(lastJ?.data) ? lastJ.data : [];

  const hAgg = aggregateFromMatches(lastHome.length ? lastHome : flat, home);
  const aAgg = aggregateFromMatches(lastAway.length ? lastAway : flat, away);

  if (hAgg) {
    stats.home_form = hAgg.form;
    stats.avg_goals = hAgg.avgGoals; stats.btts_pct = hAgg.btts;
    stats.over05_pct = hAgg.over05; stats.over15_pct = hAgg.over15;
    stats.over25_pct = hAgg.over25; stats.over35_pct = hAgg.over35;
    stats.clean_sheets_pct = hAgg.cleanSheets;
  }
  if (aAgg) {
    stats.away_form = aAgg.form;
    if (stats.avg_goals !== null) {
      stats.avg_goals = (stats.avg_goals + aAgg.avgGoals) / 2;
      stats.btts_pct = ((stats.btts_pct ?? 0) + aAgg.btts) / 2;
      stats.over05_pct = ((stats.over05_pct ?? 0) + aAgg.over05) / 2;
      stats.over15_pct = ((stats.over15_pct ?? 0) + aAgg.over15) / 2;
      stats.over25_pct = ((stats.over25_pct ?? 0) + aAgg.over25) / 2;
      stats.over35_pct = ((stats.over35_pct ?? 0) + aAgg.over35) / 2;
      stats.clean_sheets_pct = ((stats.clean_sheets_pct ?? 0) + aAgg.cleanSheets) / 2;
    } else {
      stats.avg_goals = aAgg.avgGoals; stats.btts_pct = aAgg.btts;
      stats.over05_pct = aAgg.over05; stats.over15_pct = aAgg.over15;
      stats.over25_pct = aAgg.over25; stats.over35_pct = aAgg.over35;
      stats.clean_sheets_pct = aAgg.cleanSheets;
    }
  }

  const h2hList = h2hJ?.data?.matches || h2hJ?.data || [];
  if (Array.isArray(h2hList) && h2hList.length > 0) {
    stats.h2h = h2hList.slice(0, 10).map((e: any) => ({
      date: e?.date || e?.timestamp || null,
      home: e?.teams?.home?.name || e?.home || null,
      away: e?.teams?.away?.name || e?.away || null,
      score: `${e?.score?.current?.home ?? e?.score?.home ?? "-"}-${e?.score?.current?.away ?? e?.score?.away ?? "-"}`,
    }));
  }
  return fieldsFilled(stats) > 0 ? stats : null;
}

// ── Persistência ─────────────────────────────────────────────────
async function loadFromDb(matchId: string, maxAgeSec: number): Promise<any | null> {
  const { data } = await sb()
    .from("match_stats_fallback")
    .select("*")
    .eq("match_id", matchId)
    .maybeSingle();
  if (!data) return null;
  const ageSec = (Date.now() - new Date(data.updated_at).getTime()) / 1000;
  if (maxAgeSec > 0 && ageSec > maxAgeSec) return null;
  return data;
}

async function persist(payload: {
  match_id: string; home_team: string; away_team: string;
  league: string | null; kickoff_at: string | null;
  stats: Stats; source: string; confidence_score: number; raw?: any;
}) {
  try {
    await sb().from("match_stats_fallback").upsert({
      match_id: payload.match_id,
      home_team: payload.home_team,
      away_team: payload.away_team,
      league: payload.league,
      kickoff_at: payload.kickoff_at,
      avg_goals: payload.stats.avg_goals,
      avg_corners: payload.stats.avg_corners,
      btts_pct: payload.stats.btts_pct,
      over05_pct: payload.stats.over05_pct,
      over15_pct: payload.stats.over15_pct,
      over25_pct: payload.stats.over25_pct,
      over35_pct: payload.stats.over35_pct,
      clean_sheets_pct: payload.stats.clean_sheets_pct,
      home_form: payload.stats.home_form,
      away_form: payload.stats.away_form,
      h2h_json: payload.stats.h2h,
      source: payload.source,
      confidence_score: payload.confidence_score,
      raw_payload: payload.raw ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "match_id" });
  } catch (e) { console.error("persist", e); }
}

async function log(entry: {
  match_id?: string; source_used: string; latency_ms: number;
  cache_hit: boolean; api_football_failed?: boolean;
  confidence_score?: number; error_message?: string;
}) {
  try { await sb().from("fallback_logs").insert(entry); } catch (e) { console.error("log", e); }
}

// ── Handler ──────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const t0 = Date.now();

  try {
    const body = await req.json();
    const matchId = String(body.matchId || body.fixtureId || "");
    const homeTeam = String(body.homeTeam || "");
    const awayTeam = String(body.awayTeam || "");
    const league = body.league ?? null;
    const kickoffISO = body.kickoffISO ?? null;

    if (!matchId || !homeTeam || !awayTeam) {
      return new Response(JSON.stringify({ error: "matchId, homeTeam, awayTeam obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1) Banco fresco (< 7 dias) — atende cache + DB de uma vez.
    //    Ignora registros vazios ("none"/0) para não bloquear nova tentativa.
    const fresh = await loadFromDb(matchId, TTL.team_stats);
    const freshHasData = fresh && fresh.source !== "none" && Number(fresh.confidence_score || 0) > 0;
    if (freshHasData) {
      await log({
        match_id: matchId, source_used: fresh.source, latency_ms: Date.now() - t0,
        cache_hit: true, confidence_score: fresh.confidence_score,
      });
      const stats: Stats = {
        avg_goals: fresh.avg_goals, avg_corners: fresh.avg_corners,
        btts_pct: fresh.btts_pct, over05_pct: fresh.over05_pct,
        over15_pct: fresh.over15_pct, over25_pct: fresh.over25_pct,
        over35_pct: fresh.over35_pct, clean_sheets_pct: fresh.clean_sheets_pct,
        home_form: fresh.home_form, away_form: fresh.away_form, h2h: fresh.h2h_json,
      };
      return new Response(JSON.stringify({
        stats, source: fresh.source, confidence_score: fresh.confidence_score,
        lowConfidence: fresh.confidence_score < 70,
        missing: missingFields(stats),
        cached: true,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 2) SportsRC v2 (provider primário — prioridade 1)
    const src = await fromSportsRC(matchId, homeTeam, awayTeam);
    if (src) {
      const score = computeConfidence(src, "api-football"); // peso máximo
      await persist({
        match_id: matchId, home_team: homeTeam, away_team: awayTeam,
        league, kickoff_at: kickoffISO,
        stats: src, source: "sportsrc", confidence_score: score,
      });
      await log({
        match_id: matchId, source_used: "sportsrc", latency_ms: Date.now() - t0,
        cache_hit: false, confidence_score: score,
      });
      console.info(`[match-stats-resolver] provider_used=sportsrc latency=${Date.now() - t0}ms confidence=${score}`);
      return new Response(JSON.stringify({
        stats: src, source: "sportsrc", confidence_score: score,
        lowConfidence: score < 70, missing: missingFields(src), cached: false,
        provider_used: "sportsrc", provider_latency: Date.now() - t0, provider_confidence: score,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 3) TheSportsDB (fallback público estável)
    const tsdb = await fromTheSportsDB(homeTeam, awayTeam);
    if (tsdb) {
      const score = computeConfidence(tsdb, "thesportsdb");
      await persist({
        match_id: matchId, home_team: homeTeam, away_team: awayTeam,
        league, kickoff_at: kickoffISO,
        stats: tsdb, source: "thesportsdb", confidence_score: score,
      });
      await log({
        match_id: matchId, source_used: "thesportsdb", latency_ms: Date.now() - t0,
        cache_hit: false, api_football_failed: true, confidence_score: score,
      });
      console.info(`[match-stats-resolver] provider_used=thesportsdb latency=${Date.now() - t0}ms confidence=${score}`);
      return new Response(JSON.stringify({
        stats: tsdb, source: "thesportsdb", confidence_score: score,
        lowConfidence: score < 70, missing: missingFields(tsdb), cached: false,
        provider_used: "thesportsdb", provider_latency: Date.now() - t0, provider_confidence: score,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 3) Histórico antigo (qualquer idade) — último recurso
    const stale = await loadFromDb(matchId, 0);
    if (stale) {
      await log({
        match_id: matchId, source_used: "historical", latency_ms: Date.now() - t0,
        cache_hit: true, api_football_failed: true,
        confidence_score: Math.min(70, stale.confidence_score),
      });
      const stats: Stats = {
        avg_goals: stale.avg_goals, avg_corners: stale.avg_corners,
        btts_pct: stale.btts_pct, over05_pct: stale.over05_pct,
        over15_pct: stale.over15_pct, over25_pct: stale.over25_pct,
        over35_pct: stale.over35_pct, clean_sheets_pct: stale.clean_sheets_pct,
        home_form: stale.home_form, away_form: stale.away_form, h2h: stale.h2h_json,
      };
      const score = Math.min(70, stale.confidence_score);
      return new Response(JSON.stringify({
        stats, source: "historical", confidence_score: score,
        lowConfidence: true, missing: missingFields(stats), cached: true,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 4) Sem dados em lugar nenhum
    await log({
      match_id: matchId, source_used: "none", latency_ms: Date.now() - t0,
      cache_hit: false, api_football_failed: true, confidence_score: 0,
      error_message: "no data available",
    });
    return new Response(JSON.stringify({
      stats: emptyStats(), source: "none", confidence_score: 0,
      lowConfidence: true, missing: [...STAT_FIELDS], cached: false,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e: any) {
    console.error("resolver error", e);
    await log({
      source_used: "error", latency_ms: Date.now() - t0,
      cache_hit: false, api_football_failed: true,
      error_message: String(e?.message || e),
    });
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
