import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BASE_URL = "https://v3.football.api-sports.io";

// ========================
// GLOBAL API CALL COUNTER (per invocation)
// ========================
let apiCallCount = 0;
const API_CALL_LIMIT = 120;

function canCallAPI(): boolean {
  return apiCallCount < API_CALL_LIMIT;
}

// In-memory cache (fast, per-instance, complements DB cache)
const memCache = new Map<string, { timestamp: number; data: any }>();

function memGet(key: string, ttlMs: number) {
  const entry = memCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > ttlMs) { memCache.delete(key); return null; }
  return entry.data;
}
function memSet(key: string, data: any) {
  memCache.set(key, { timestamp: Date.now(), data });
}
function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ========================
// SUPABASE DB CACHE LAYER
// ========================
const CACHE_TTL = {
  LIVE: 2 * 60 * 1000,        // 2 minutes
  PRE: 12 * 60 * 60 * 1000,   // 12 hours
  FINISHED: Infinity,          // Never expires
  STATS: 24 * 60 * 60 * 1000, // 24 hours for fixture stats
};

function getSupabaseAdmin() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, serviceKey);
}

async function dbCacheGet(cacheKey: string, statusJogo: string): Promise<any | null> {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("cache_api")
      .select("dados_json, ultima_atualizacao, status_jogo")
      .eq("cache_key", cacheKey)
      .maybeSingle();

    if (error || !data) return null;

    const ttl = CACHE_TTL[data.status_jogo as keyof typeof CACHE_TTL] ?? CACHE_TTL.PRE;
    if (ttl === Infinity) return data.dados_json;

    const age = Date.now() - new Date(data.ultima_atualizacao).getTime();
    if (age > ttl) return null;

    return data.dados_json;
  } catch (e) {
    console.error("DB cache read error:", e);
    return null;
  }
}

async function dbCacheSet(cacheKey: string, dados: any, statusJogo: string): Promise<void> {
  try {
    const sb = getSupabaseAdmin();
    await sb
      .from("cache_api")
      .upsert({
        cache_key: cacheKey,
        dados_json: dados,
        status_jogo: statusJogo,
        ultima_atualizacao: new Date().toISOString(),
      }, { onConflict: "cache_key" });
  } catch (e) {
    console.error("DB cache write error:", e);
  }
}

// ========================
// LEAGUE CONFIG
// ========================
const LEAGUES_TO_ANALYZE = [71, 39, 140, 78, 135, 61, 13, 2];
const LEAGUES_WITH_STATS = new Set([
  71, 39, 140, 78, 135, 61, 253, 128, 262, 13, 11, 2, 3, 88, 94, 40, 239,
  345, 299, 268, 242, 307, 332,
]);

const LEAGUE_DISPLAY_NAMES: Record<number, string> = {
  71: 'Brasileirão Série A', 39: 'Premier League', 140: 'La Liga',
  78: 'Bundesliga', 135: 'Serie A (ITA)', 61: 'Ligue 1', 253: 'MLS',
  128: 'Liga Argentina', 262: 'Liga MX', 13: 'Copa Libertadores',
  11: 'Copa Sudamericana', 2: 'Champions League', 3: 'Europa League',
  88: 'Eredivisie', 94: 'Liga Portugal', 40: 'Championship',
  239: 'Brasileirão Série B', 299: 'Division Profesional',
  268: 'Primera División (BOL)', 242: 'Liga Pro (ECU)',
};

function getLeagueDisplayName(leagueId: number, fallbackName: string): string {
  return LEAGUE_DISPLAY_NAMES[leagueId] || fallbackName;
}

async function fetchWithAuth(endpoint: string, apiKey: string): Promise<any> {
  if (!canCallAPI()) {
    console.warn(`API LIMIT REACHED (${apiCallCount}/${API_CALL_LIMIT}). Blocking: ${endpoint}`);
    return { response: [] };
  }
  apiCallCount++;
  console.log(`API call #${apiCallCount}: ${endpoint}`);
  const res = await fetch(`${BASE_URL}/${endpoint}`, {
    headers: { "x-apisports-key": apiKey },
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`API error ${res.status}: ${text}`);
    throw new Error(`API ${res.status}`);
  }
  return res.json();
}

function extractStats(stats: any[]) {
  if (!stats || stats.length === 0) return null;
  const get = (name: string) => {
    const val = stats.find((s: any) => s.type === name)?.value;
    return val === null || val === undefined ? 0 : Number(String(val).replace('%', ''));
  };
  return {
    shotsOnGoal: get("Shots on Goal"),
    possession: get("Ball Possession"),
    corners: get("Corner Kicks"),
    totalShots: get("Total Shots"),
    dangerousAttacks: get("Dangerous Attacks"),
  };
}

function getStat(stats: any[], name: string): number {
  const val = stats.find((s: any) => s.type === name)?.value;
  return val === null || val === undefined ? 0 : Number(String(val).replace('%', ''));
}

// ========================
// shouldFetchStats — Smart filter for LIVE stats
// ========================
function shouldFetchLiveStats(
  match: any,
  leagueId: number
): boolean {
  const minute = match?.fixture?.status?.elapsed || 0;
  if (minute < 8) return false; // Too early, no useful data

  // Priority leagues always get stats
  if (LEAGUES_WITH_STATS.has(leagueId)) return true;

  // For other leagues, fetch if enough time has passed (API may have data)
  if (minute >= 15) return true;

  // Also fetch if there are goals (interesting game)
  const homeGoals = match?.goals?.home ?? 0;
  const awayGoals = match?.goals?.away ?? 0;
  if (homeGoals + awayGoals > 0) return true;

  return false;
}

async function fetchLeagueRecentFixtures(leagueId: number, apiKey: string): Promise<any[]> {
  const ck = `league_recent_${leagueId}`;
  
  const memCached = memGet(ck, 3600000);
  if (memCached) return memCached;

  const dbCached = await dbCacheGet(ck, "PRE");
  if (dbCached) { memSet(ck, dbCached); return dbCached; }

  if (!canCallAPI()) return [];

  const year = new Date().getFullYear();
  let games: any[] = [];

  try {
    const data = await fetchWithAuth(
      `fixtures?league=${leagueId}&season=${year}&status=FT&last=50`, apiKey
    );
    games = data?.response || [];

    if (games.length < 20 && canCallAPI()) {
      await delay(200);
      const data2 = await fetchWithAuth(
        `fixtures?league=${leagueId}&season=${year - 1}&status=FT&last=50`, apiKey
      );
      games = [...games, ...(data2?.response || [])];
    }
  } catch (e) {
    console.error(`League ${leagueId} fetch error:`, e);
  }

  console.log(`League ${leagueId}: ${games.length} recent finished fixtures`);
  memSet(ck, games);
  await dbCacheSet(ck, games, "PRE");
  return games;
}

// ========================
// DYNAMIC LEAGUE AVERAGE (replaces fixed 1.35)
// ========================
function calculateLeagueAvgGoals(pool: any[]): number {
  if (pool.length === 0) return 1.30; // Conservative fallback only when no data at all
  
  let totalGoals = 0;
  let count = 0;
  for (const g of pool) {
    const hg = g.goals?.home ?? 0;
    const ag = g.goals?.away ?? 0;
    if (hg + ag >= 0) {
      totalGoals += hg + ag;
      count++;
    }
  }
  
  if (count === 0) return 1.30;
  const avgPerTeam = (totalGoals / count) / 2;
  // Clamp between 0.8 and 2.0 to prevent outliers
  return Math.max(0.8, Math.min(2.0, Number(avgPerTeam.toFixed(3))));
}

function calcTeamStatsFromPool(pool: any[], teamId: number): any {
  const teamGames = pool
    .filter((g: any) => g.teams.home.id === teamId || g.teams.away.id === teamId)
    .slice(0, 5);

  if (teamGames.length === 0) return null;

  let goalsFor = 0, goalsAgainst = 0;
  const recentGoalsFor: number[] = [];
  const recentGoalsAgainst: number[] = [];

  for (const g of teamGames) {
    const isHome = g.teams.home.id === teamId;
    const gf = (isHome ? g.goals.home : g.goals.away) || 0;
    const ga = (isHome ? g.goals.away : g.goals.home) || 0;
    goalsFor += gf;
    goalsAgainst += ga;
    recentGoalsFor.push(gf);
    recentGoalsAgainst.push(ga);
  }

  const count = teamGames.length;

  // Bayesian regression: lambda_adj = (n * team_avg + k * league_avg) / (n + k)
  const leagueAvg = calculateLeagueAvgGoals(pool);
  const k = 3; // regression weight
  const rawGF = goalsFor / count;
  const rawGA = goalsAgainst / count;
  const adjGF = Number(((count * rawGF + k * leagueAvg) / (count + k)).toFixed(3));
  const adjGA = Number(((count * rawGA + k * leagueAvg) / (count + k)).toFixed(3));

  return {
    goalsFor: adjGF,
    goalsAgainst: adjGA,
    rawGoalsFor: Number(rawGF.toFixed(2)),
    rawGoalsAgainst: Number(rawGA.toFixed(2)),
    gamesCount: count,
    leagueAvg,
    totalShots: 0, shotsOnGoal: 0, corners: 0, possession: 0,
    fouls: 0, yellowCards: 0, offsides: 0, bigChances: 0,
    recentGoalsFor, recentGoalsAgainst,
    _fixtureIds: teamGames.map((g: any) => g.fixture.id),
  };
}

async function enrichWithDetailedStats(
  stats: any, teamId: number, pool: any[], apiKey: string
): Promise<any> {
  if (!stats || !stats._fixtureIds) return stats;

  const teamGames = pool
    .filter((g: any) => g.teams.home.id === teamId || g.teams.away.id === teamId)
    .slice(0, 3); // LIMIT: only 3 recent games for stats (saves API credits)

  let totalShots = 0, shotsOnGoal = 0, corners = 0, possession = 0;
  let fouls = 0, yellowCards = 0, offsides = 0, bigChances = 0;
  let statsCount = 0;

  for (const g of teamGames) {
    if (!canCallAPI()) break; // Respect global limit

    const fId = g.fixture.id;
    const ck = `fstats_${fId}`;

    let fStats = memGet(ck, 86400000);

    if (!fStats) {
      const dbData = await dbCacheGet(ck, "FINISHED");
      if (dbData) { fStats = dbData; memSet(ck, dbData); }
    }

    if (!fStats) {
      try {
        const data = await fetchWithAuth(`fixtures/statistics?fixture=${fId}`, apiKey);
        fStats = data?.response || [];
        memSet(ck, fStats);
        await dbCacheSet(ck, fStats, "FINISHED");
        await delay(80);
      } catch { continue; }
    }

    if (fStats && fStats.length >= 2) {
      const isHome = g.teams.home.id === teamId;
      const teamIdx = isHome ? 0 : 1;
      const s = fStats[teamIdx]?.statistics || [];
      totalShots += getStat(s, "Total Shots");
      shotsOnGoal += getStat(s, "Shots on Goal");
      corners += getStat(s, "Corner Kicks");
      possession += getStat(s, "Ball Possession");
      fouls += getStat(s, "Fouls");
      yellowCards += getStat(s, "Yellow Cards");
      offsides += getStat(s, "Offsides");
      bigChances += getStat(s, "Expected Goals") || 0;
      statsCount++;
    }
  }

  if (statsCount > 0) {
    stats.totalShots = Number((totalShots / statsCount).toFixed(1));
    stats.shotsOnGoal = Number((shotsOnGoal / statsCount).toFixed(1));
    stats.corners = Number((corners / statsCount).toFixed(1));
    stats.possession = Number((possession / statsCount).toFixed(1));
    stats.fouls = Number((fouls / statsCount).toFixed(1));
    stats.yellowCards = Number((yellowCards / statsCount).toFixed(1));
    stats.offsides = Number((offsides / statsCount).toFixed(1));
    stats.bigChances = Number((bigChances / statsCount).toFixed(1));
  }

  delete stats._fixtureIds;
  return stats;
}

serve(async (req) => {
  // Reset counter per invocation
  apiCallCount = 0;

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("API_FUTEBOL_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "API key missing", matches: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({}));
    const isLive = body?.live === true;
    const fixtureId = body?.fixture;
    const date = body?.date || new Date().toISOString().split("T")[0];

    // ========== STATS for a specific fixture ==========
    if (fixtureId) {
      const dbCk = `stats_${fixtureId}`;

      const memCached = memGet(dbCk, 20000);
      if (memCached) {
        return new Response(JSON.stringify(memCached), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const dbCached = await dbCacheGet(dbCk, "STATS");
      if (dbCached) {
        memSet(dbCk, dbCached);
        return new Response(JSON.stringify(dbCached), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const sData = await fetchWithAuth(`fixtures/statistics?fixture=${fixtureId}`, apiKey);
      const responseData = { response: sData?.response || [] };
      memSet(dbCk, responseData);
      await dbCacheSet(dbCk, responseData, "STATS");
      return new Response(JSON.stringify(responseData), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ========== LIVE fixtures ==========
    if (isLive) {
      const liveCk = "live_all";

      const memCached = memGet("live_v3", 30000);
      if (memCached) {
        const allHaveStats = memCached.matches.every((m: any) => m.stats?.home !== null || m.stats?.away !== null);
        if (allHaveStats) {
          return new Response(JSON.stringify(memCached), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        memCache.delete("live_v3");
      }

      const dbCached = await dbCacheGet(liveCk, "LIVE");
      if (dbCached) {
        memSet("live_v3", dbCached);
        return new Response(JSON.stringify(dbCached), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const fixturesData = await fetchWithAuth("fixtures?live=all", apiKey);
      const fixtures = fixturesData?.response || [];
      console.log(`Live: ${fixtures.length} fixtures found`);

      const matches = [];

      for (let i = 0; i < fixtures.length; i++) {
        const j = fixtures[i];
        const fId = j.fixture.id;
        const leagueId = j.league?.id;
        let stats = { home: null as any, away: null as any };

        // Smart filter: only fetch stats for relevant games
        if (shouldFetchLiveStats(j, leagueId)) {
          const fStatsCk = `live_fstats_${fId}`;
          const cachedFStats = memGet(fStatsCk, 30000) || await dbCacheGet(fStatsCk, "LIVE");

          if (cachedFStats) {
            stats = cachedFStats;
            memSet(fStatsCk, cachedFStats);
          } else if (canCallAPI()) {
            try {
              const sData = await fetchWithAuth(`fixtures/statistics?fixture=${fId}`, apiKey);
              const resS = sData?.response || [];
              if (resS.length >= 2) {
                stats.home = extractStats(resS[0].statistics);
                stats.away = extractStats(resS[1].statistics);
              }
            } catch (e) { console.error(`Stats error for ${fId}:`, e); }

            if (stats.home !== null || stats.away !== null) {
              memSet(fStatsCk, stats);
              await dbCacheSet(fStatsCk, stats, "LIVE");
            }
          }
        }

        matches.push({
          id: fId, isLive: true, teams: j.teams, goals: j.goals,
          fixture: j.fixture, league: getLeagueDisplayName(j.league?.id, j.league?.name || ''),
          homeStats: null, awayStats: null, stats,
        });

        if ((i + 1) % 3 === 0 && i < fixtures.length - 1) {
          await delay(150);
        }
      }

      console.log(`Live: returning ${matches.length} matches, ${matches.filter((m: any) => m.stats?.home !== null).length} with stats. API calls: ${apiCallCount}`);
      const responseData = { matches };
      memSet("live_v3", responseData);
      await dbCacheSet(liveCk, responseData, "LIVE");
      return new Response(JSON.stringify(responseData), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ========== PRE-MATCH fixtures ==========
    const preCk = `date_${date}`;

    const memCached = memGet(`date_v14_${date}`, 7200000);
    if (memCached) {
      console.log("Memory cache hit (pre)");
      return new Response(JSON.stringify(memCached), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const dbCached = await dbCacheGet(preCk, "PRE");
    if (dbCached) {
      console.log("DB cache hit (pre)");
      memSet(`date_v14_${date}`, dbCached);
      return new Response(JSON.stringify(dbCached), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const fixturesData = await fetchWithAuth(`fixtures?date=${date}`, apiKey);
    let fixtures = fixturesData?.response || [];
    console.log(`Got ${fixtures.length} total fixtures`);

    fixtures = fixtures.filter((f: any) => {
      const status = f.fixture?.status?.short || '';
      return status === 'NS' && LEAGUES_TO_ANALYZE.includes(f.league?.id);
    });
    console.log(`Filtered to ${fixtures.length} target fixtures`);

    const neededLeagues = new Set(fixtures.map((f: any) => f.league?.id).filter(Boolean));

    const leaguePools = new Map<number, any[]>();
    for (const leagueId of neededLeagues) {
      if (!canCallAPI()) break;
      const pool = await fetchLeagueRecentFixtures(leagueId, apiKey);
      leaguePools.set(leagueId, pool);
      await delay(200);
    }

    const teamStatsCache = new Map<number, any>();
    for (const f of fixtures) {
      const leagueId = f.league?.id;
      const pool = leaguePools.get(leagueId) || [];
      for (const teamId of [f.teams.home.id, f.teams.away.id]) {
        if (!teamStatsCache.has(teamId)) {
          teamStatsCache.set(teamId, calcTeamStatsFromPool(pool, teamId));
        }
      }
    }

    for (const [teamId, stats] of teamStatsCache) {
      if (!stats) continue;
      if (!canCallAPI()) break;
      const leagueId = fixtures.find(
        (f: any) => f.teams.home.id === teamId || f.teams.away.id === teamId
      )?.league?.id;
      const pool = leaguePools.get(leagueId) || [];
      const enriched = await enrichWithDetailedStats(stats, teamId, pool, apiKey);
      teamStatsCache.set(teamId, enriched);
    }

    const matches = fixtures.map((j: any) => ({
      id: j.fixture.id,
      isLive: false,
      teams: j.teams,
      goals: j.goals,
      fixture: j.fixture,
      league: getLeagueDisplayName(j.league?.id, j.league?.name || ''),
      homeStats: teamStatsCache.get(j.teams.home.id) || null,
      awayStats: teamStatsCache.get(j.teams.away.id) || null,
      stats: { home: null, away: null },
    }));

    console.log(`Returning ${matches.length} matches. API calls used: ${apiCallCount}`);
    const responseData = { matches };
    memSet(`date_v14_${date}`, responseData);
    await dbCacheSet(preCk, responseData, "PRE");
    return new Response(JSON.stringify(responseData), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("Edge function error:", err);
    return new Response(JSON.stringify({ matches: [], error: String(err) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
