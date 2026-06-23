// =====================================================================
// football-api — SportsRC adapter
// ---------------------------------------------------------------------
// Esta função foi reescrita para usar exclusivamente a SportsRC v2.
// A API-Sports foi removida do projeto. O nome da função e o formato
// de resposta foram preservados para não quebrar callers existentes:
//
//   POST { date: 'YYYY-MM-DD' }  → { matches: [{ id, fixture, league, teams, goals }] }
//   POST { live: true }          → idem (somente jogos LIVE)
//   POST { fixture: <id> }       → { response: [ { team, statistics: [{type, value}] }, ... ] }
//
// Cache em DB (cache_api) é mantido para não esgotar a cota de 1000/dia.
// =====================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SPORTSRC_BASE = "https://api.sportsrc.org/v2";
const SPORTSRC_KEY = Deno.env.get("SPORTSRC_API_KEY") || "";

const CACHE_TTL = {
  LIVE: 60 * 1000,            // 60s
  PRE: 6 * 60 * 60 * 1000,    // 6h
  STATS_LIVE: 90 * 1000,      // 90s
  STATS_FINAL: 7 * 24 * 60 * 60 * 1000, // 7d
};

const LIVE_STATUSES = new Set(["1H", "2H", "HT", "ET", "P", "LIVE", "INPROGRESS", "IN_PROGRESS", "HALFTIME", "1ST HALF", "2ND HALF", "FIRSTHALF", "SECONDHALF"]);
const FINISHED_STATUSES = new Set(["FT", "AET", "PEN", "FINISHED", "ENDED", "FULL TIME", "FULLTIME", "FULL-TIME"]);

function getSb() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function cacheGet(key: string, ttlMs: number): Promise<any | null> {
  try {
    const sb = getSb();
    const { data } = await sb.from("cache_api")
      .select("dados_json, ultima_atualizacao")
      .eq("cache_key", key).maybeSingle();
    if (!data) return null;
    const age = Date.now() - new Date(data.ultima_atualizacao).getTime();
    if (age > ttlMs) return null;
    return data.dados_json;
  } catch { return null; }
}

async function cacheGetStale(key: string): Promise<any | null> {
  try {
    const sb = getSb();
    const { data } = await sb.from("cache_api")
      .select("dados_json").eq("cache_key", key).maybeSingle();
    return data?.dados_json ?? null;
  } catch { return null; }
}

async function cacheSet(key: string, payload: any, statusJogo: string) {
  try {
    const sb = getSb();
    await sb.from("cache_api").upsert({
      cache_key: key, dados_json: payload, status_jogo: statusJogo,
      ultima_atualizacao: new Date().toISOString(),
    }, { onConflict: "cache_key" });
  } catch (e) { console.error("cache write", e); }
}

async function srcFetch(params: Record<string, string>): Promise<any> {
  if (!SPORTSRC_KEY) throw new Error("SPORTSRC_API_KEY missing");
  const url = new URL(SPORTSRC_BASE + "/");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url.toString(), {
      headers: { "X-API-KEY": SPORTSRC_KEY, "Accept": "application/json" },
      signal: ctrl.signal,
    });
    clearTimeout(to);
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { json = null; }
    if (!res.ok) throw new Error(`sportsrc ${res.status}`);
    return json;
  } finally { clearTimeout(to); }
}

function normStatus(raw: any): { short: string; elapsed: number | null } {
  const s = String(raw || "").toUpperCase().trim();
  if (!s) return { short: "NS", elapsed: null };
  // Live mapping
  if (s === "1ST HALF" || s === "FIRSTHALF" || s === "1H") return { short: "1H", elapsed: null };
  if (s === "2ND HALF" || s === "SECONDHALF" || s === "2H") return { short: "2H", elapsed: null };
  if (s === "HALFTIME" || s === "HT" || s === "HALF TIME" || s === "HALF-TIME") return { short: "HT", elapsed: 45 };
  if (s === "ET" || s === "EXTRA TIME") return { short: "ET", elapsed: 90 };
  if (s === "PENALTIES" || s === "P" || s === "PEN") return { short: "P", elapsed: 120 };
  if (s === "LIVE" || s === "INPROGRESS" || s === "IN_PROGRESS") return { short: "1H", elapsed: null };
  // Finished
  if (FINISHED_STATUSES.has(s)) return { short: "FT", elapsed: 90 };
  // Scheduled
  if (s === "NS" || s === "SCHEDULED" || s === "NOT STARTED" || s === "NOT_STARTED" || s === "TBD") return { short: "NS", elapsed: null };
  // Cancelled / Postponed
  if (s === "CANC" || s === "CANCELED" || s === "CANCELLED" || s === "PST" || s === "POSTPONED") return { short: "CANC", elapsed: null };
  return { short: s, elapsed: null };
}

function mapMatch(m: any, league: any): any {
  const id = m?.id ?? m?.fixture_id;
  const ts = typeof m?.timestamp === "number" ? m.timestamp * (m.timestamp < 1e12 ? 1000 : 1) : null;
  const iso = ts ? new Date(ts).toISOString() : new Date().toISOString();
  const st = normStatus(m?.status_detail || m?.status);
  const homeName = m?.teams?.home?.name || "";
  const awayName = m?.teams?.away?.name || "";
  const score = m?.score?.current || {};
  return {
    id,
    homeTeam: homeName,
    awayTeam: awayName,
    fixture: {
      id,
      date: iso,
      timestamp: ts ? Math.floor(ts / 1000) : null,
      status: { short: st.short, long: m?.status_detail || st.short, elapsed: m?.minute ?? st.elapsed },
    },
    league: {
      id: league?.id ?? null,
      name: league?.name ?? "Outros",
      country: league?.country ?? league?.cc ?? null,
      logo: league?.logo || league?.badge || null,
    },
    teams: {
      home: { id: m?.teams?.home?.id ?? null, name: homeName, logo: m?.teams?.home?.badge || null },
      away: { id: m?.teams?.away?.id ?? null, name: awayName, logo: m?.teams?.away?.badge || null },
    },
    goals: {
      home: typeof score.home === "number" ? score.home : null,
      away: typeof score.away === "number" ? score.away : null,
    },
    __source: "sportsrc",
  };
}

async function fetchMatchesByDate(date: string, liveOnly: boolean): Promise<any[]> {
  const key = liveOnly ? `srcv2_live_all` : `srcv2_date_${date}`;
  const ttl = liveOnly ? CACHE_TTL.LIVE : CACHE_TTL.PRE;
  const cached = await cacheGet(key, ttl);
  if (cached) return cached;

  const params: Record<string, string> = liveOnly ? { type: "matches", status: "live" } : { type: "matches", date };
  let json: any = null;
  try { json = await srcFetch(params); }
  catch (e) {
    console.warn("[football-api] sportsrc error", e instanceof Error ? e.message : e);
    const stale = await cacheGetStale(key);
    return Array.isArray(stale) ? stale : [];
  }

  const groups: any[] = Array.isArray(json?.data) ? json.data : (Array.isArray(json) ? json : []);
  const out: any[] = [];
  for (const g of groups) {
    const league = g?.league || g?.tournament || null;
    const list: any[] = Array.isArray(g?.matches) ? g.matches : [];
    for (const m of list) {
      const mapped = mapMatch(m, league);
      if (liveOnly) {
        if (LIVE_STATUSES.has(mapped.fixture.status.short)) out.push(mapped);
      } else {
        out.push(mapped);
      }
    }
  }

  await cacheSet(key, out, liveOnly ? "LIVE" : "PRE");
  return out;
}

const STAT_KEY_MAP: Record<string, string[]> = {
  "Shots on Goal": ["shots_on_target", "shots_on_goal", "shots_on", "sot"],
  "Total Shots": ["shots_total", "total_shots", "shots"],
  "Shots off Goal": ["shots_off_target", "shots_off"],
  "Corner Kicks": ["corners", "corner_kicks"],
  "Ball Possession": ["possession", "ball_possession"],
  "Dangerous Attacks": ["dangerous_attacks", "attacks_dangerous"],
  "Attacks": ["attacks"],
  "Yellow Cards": ["yellow_cards", "yellowcards", "yellows"],
  "Red Cards": ["red_cards", "redcards", "reds"],
  "Fouls": ["fouls"],
  "Offsides": ["offsides"],
  "Goalkeeper Saves": ["saves", "goalkeeper_saves"],
};

function pickStat(obj: any, candidates: string[]): any {
  if (!obj) return null;
  for (const k of candidates) {
    if (obj[k] != null) return obj[k];
    if (obj[k.toUpperCase()] != null) return obj[k.toUpperCase()];
  }
  return null;
}

function toApiSportsStats(teamMeta: any, srcSide: any): any {
  const statistics: any[] = [];
  for (const [apiType, keys] of Object.entries(STAT_KEY_MAP)) {
    const v = pickStat(srcSide, keys);
    statistics.push({ type: apiType, value: v != null ? (apiType === "Ball Possession" ? `${v}%` : v) : null });
  }
  return { team: teamMeta || { id: null, name: null }, statistics };
}

async function fetchFixtureStats(fixtureId: string | number): Promise<any> {
  const key = `srcv2_stats_${fixtureId}`;
  const cached = await cacheGet(key, CACHE_TTL.STATS_LIVE);
  if (cached) return cached;

  // SportsRC FREE plan: type=stats requires paid plan.
  // Use type=detail (free) to extract scores + half-time + status.
  // Statistics (shots, corners, possession) ficam vazios; engines aplicam
  // derivações (proxy DA, Poisson) automaticamente.
  let json: any = null;
  try { json = await srcFetch({ type: "detail", id: String(fixtureId) }); }
  catch (e) {
    console.warn("[football-api] detail error", e instanceof Error ? e.message : e);
    const stale = await cacheGetStale(key);
    return stale ?? { response: [] };
  }

  const mi = json?.data?.match_info || {};
  const teamsRaw = mi?.teams || {};
  const score = mi?.score || {};
  const cur = score?.current || {};
  const period1: string = String(score?.period_1 || "");
  const [ht1, ht2] = period1.includes("-") ? period1.split("-").map((s) => Number(s.trim())) : [null, null];

  const homeTeam = { id: null, name: teamsRaw?.home?.name || null };
  const awayTeam = { id: null, name: teamsRaw?.away?.name || null };
  // Stats vazios — engines derivam de outras métricas
  const out = {
    response: [
      toApiSportsStats(homeTeam, null),
      toApiSportsStats(awayTeam, null),
    ],
    extra: {
      goals: { home: cur?.home ?? null, away: cur?.away ?? null },
      halftime: { home: ht1 ?? null, away: ht2 ?? null },
      status: mi?.status_detail || mi?.status || null,
      venue: mi?.venue || null,
    },
    provider: "sportsrc",
  };

  const ttl = String(mi?.status || "").toLowerCase() === "finished" ? "STATS" : "LIVE";
  await cacheSet(key, out, ttl);
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));

    // Modo stats: { fixture: <id> }
    if (body?.fixture != null) {
      const stats = await fetchFixtureStats(body.fixture);
      return new Response(JSON.stringify(stats), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Modo live
    if (body?.live === true) {
      const matches = await fetchMatchesByDate("", true);
      return new Response(JSON.stringify({ matches, provider: "sportsrc" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Modo pré-jogo por data
    const date = String(body?.date || new Date().toISOString().slice(0, 10));
    const matches = await fetchMatchesByDate(date, false);
    return new Response(JSON.stringify({ matches, provider: "sportsrc" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[football-api] fatal", msg);
    return new Response(JSON.stringify({ error: msg, matches: [], response: [] }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
