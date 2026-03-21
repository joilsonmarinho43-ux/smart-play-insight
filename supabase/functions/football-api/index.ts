import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BASE_URL = "https://v3.football.api-sports.io";
const memCache = new Map<string, { timestamp: number; data: any }>();

function cacheGet(key: string, ttlMs: number) {
  const entry = memCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > ttlMs) { memCache.delete(key); return null; }
  return entry.data;
}
function cacheSet(key: string, data: any) {
  memCache.set(key, { timestamp: Date.now(), data });
}

// Brasileirão A (71), Premier League (39), La Liga (140), Bundesliga (78), Serie A Italia (135), Ligue 1 (61)
const LEAGUES_TO_ANALYZE = [71, 39, 140, 78, 135, 61];

async function fetchWithAuth(endpoint: string, apiKey: string) {
  console.log(`API call: ${endpoint}`);
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

/** Fetch fixture stats with 24h cache (finished games never change) */
async function getFixtureStats(fixtureId: number, apiKey: string): Promise<any[]> {
  const ck = `fstats_${fixtureId}`;
  const cached = cacheGet(ck, 86400000); // 24h
  if (cached) return cached;
  try {
    const data = await fetchWithAuth(`fixtures/statistics?fixture=${fixtureId}`, apiKey);
    const result = data?.response || [];
    cacheSet(ck, result);
    return result;
  } catch {
    return [];
  }
}

/** Extract a stat value from a statistics array */
function getStat(stats: any[], name: string): number {
  const val = stats.find((s: any) => s.type === name)?.value;
  return val === null || val === undefined ? 0 : Number(String(val).replace('%', ''));
}

/** Calculate detailed team stats from last N games with per-fixture statistics */
async function calcTeamStatsDetailed(games: any[], teamId: number, apiKey: string) {
  const empty = {
    goalsFor: 0, goalsAgainst: 0, gamesCount: 0,
    shotsOnGoal: 0, totalShots: 0, corners: 0, possession: 0,
    fouls: 0, yellowCards: 0, offsides: 0, bigChances: 0,
    recentGoalsFor: [] as number[], recentGoalsAgainst: [] as number[],
  };
  if (!games || games.length === 0) return empty;

  let goalsFor = 0, goalsAgainst = 0;
  let totalShots = 0, shotsOnGoal = 0, corners = 0, possession = 0;
  let fouls = 0, yellowCards = 0, offsides = 0, bigChances = 0;
  const recentGoalsFor: number[] = [];
  const recentGoalsAgainst: number[] = [];
  let statsCount = 0;

  // Fetch all fixture stats in parallel
  const statsResults = await Promise.all(
    games.map(g => getFixtureStats(g.fixture.id, apiKey))
  );

  games.forEach((g, idx) => {
    const isHome = g.teams.home.id === teamId;
    const gf = (isHome ? g.goals.home : g.goals.away) || 0;
    const ga = (isHome ? g.goals.away : g.goals.home) || 0;
    goalsFor += gf;
    goalsAgainst += ga;
    recentGoalsFor.push(gf);
    recentGoalsAgainst.push(ga);

    const fStats = statsResults[idx];
    if (fStats && fStats.length >= 2) {
      const teamIdx = isHome ? 0 : 1;
      const stats = fStats[teamIdx]?.statistics || [];
      totalShots += getStat(stats, "Total Shots");
      shotsOnGoal += getStat(stats, "Shots on Goal");
      corners += getStat(stats, "Corner Kicks");
      possession += getStat(stats, "Ball Possession");
      fouls += getStat(stats, "Fouls");
      yellowCards += getStat(stats, "Yellow Cards");
      offsides += getStat(stats, "Offsides");
      bigChances += getStat(stats, "Expected Goals") || getStat(stats, "expected_goals") || 0;
      statsCount++;
    }
  });

  const count = games.length;
  const sc = statsCount || 1;
  return {
    goalsFor: Number((goalsFor / count).toFixed(2)),
    goalsAgainst: Number((goalsAgainst / count).toFixed(2)),
    gamesCount: count,
    totalShots: Number((totalShots / sc).toFixed(1)),
    shotsOnGoal: Number((shotsOnGoal / sc).toFixed(1)),
    corners: Number((corners / sc).toFixed(1)),
    possession: Number((possession / sc).toFixed(1)),
    fouls: Number((fouls / sc).toFixed(1)),
    yellowCards: Number((yellowCards / sc).toFixed(1)),
    offsides: Number((offsides / sc).toFixed(1)),
    bigChances: Number((bigChances / sc).toFixed(1)),
    recentGoalsFor,
    recentGoalsAgainst,
  };
}

/** Fetch team stats with cache, retry on failure */
async function fetchTeamStats(teamId: number, teamName: string, apiKey: string): Promise<any> {
  const ck = `team_detailed_${teamId}`;
  const cached = cacheGet(ck, 7200000);
  if (cached) return cached;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (attempt > 0) await new Promise(r => setTimeout(r, 500));
      // Use current season + status filter to get only finished games
      const currentYear = new Date().getFullYear();
      const season = currentYear; // API uses season start year (2026 for 2026 season)
      const prevSeason = currentYear - 1; // Fallback for European leagues (2025-2026)
      
      // Try current season first, then previous if no results
      let data = await fetchWithAuth(`fixtures?team=${teamId}&season=${season}&status=FT&last=5`, apiKey);
      let games = data?.response || [];
      
      if (games.length === 0) {
        data = await fetchWithAuth(`fixtures?team=${teamId}&season=${prevSeason}&status=FT&last=5`, apiKey);
        games = data?.response || [];
      }
      
      console.log(`Team ${teamName} (${teamId}): got ${games.length} finished games`);
      if (games.length === 0) return null;
      const stats = await calcTeamStatsDetailed(games, teamId, apiKey);
      cacheSet(ck, stats);
      return stats;
    } catch (e) {
      console.error(`Team ${teamName} attempt ${attempt + 1} error:`, e);
    }
  }
  return null;
}

/** Process a single match — fetches team history + detailed stats */
async function processMatch(j: any, apiKey: string) {
  const fId = j.fixture.id;

  // Fetch home first, then away sequentially to avoid rate limits
  const hStats = await fetchTeamStats(j.teams.home.id, j.teams.home.name, apiKey);
  const aStats = await fetchTeamStats(j.teams.away.id, j.teams.away.name, apiKey);

  return {
    id: fId, isLive: false, teams: j.teams, goals: j.goals,
    fixture: j.fixture, league: j.league?.name || '',
    homeStats: hStats, awayStats: aStats,
    stats: { home: null, away: null },
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("API_FUTEBOL_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "API key missing", matches: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({}));
    const isLive = body?.live === true;
    const fixtureId = body?.fixture;
    const date = body?.date || new Date().toISOString().split("T")[0];

    // ========== STATS for a specific fixture ==========
    if (fixtureId) {
      const cached = cacheGet(`stats_${fixtureId}`, 20000);
      if (cached) {
        return new Response(JSON.stringify(cached), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const sData = await fetchWithAuth(`fixtures/statistics?fixture=${fixtureId}`, apiKey);
      const responseData = { response: sData?.response || [] };
      cacheSet(`stats_${fixtureId}`, responseData);
      return new Response(JSON.stringify(responseData), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ========== LIVE fixtures ==========
    if (isLive) {
      const cached = cacheGet("live_v3", 15000);
      if (cached) {
        console.log("Cache hit (live)");
        return new Response(JSON.stringify(cached), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const fixturesData = await fetchWithAuth("fixtures?live=all", apiKey);
      const fixtures = fixturesData?.response || [];
      console.log(`Got ${fixtures.length} live fixtures`);

      const matches = [];
      for (const j of fixtures) {
        const fId = j.fixture.id;
        let stats = { home: null as any, away: null as any };
        try {
          const sData = await fetchWithAuth(`fixtures/statistics?fixture=${fId}`, apiKey);
          const resS = sData?.response || [];
          if (resS.length >= 2) {
            stats.home = extractStats(resS[0].statistics);
            stats.away = extractStats(resS[1].statistics);
          }
        } catch (e) { console.error(`Stats error for ${fId}:`, e); }
        matches.push({
          id: fId, isLive: true, teams: j.teams, goals: j.goals,
          fixture: j.fixture, league: j.league?.name || '',
          homeStats: null, awayStats: null, stats,
        });
      }
      const responseData = { matches };
      cacheSet("live_v3", responseData);
      return new Response(JSON.stringify(responseData), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ========== PRE-MATCH fixtures ==========
    const ck = `date_v11_${date}`;
    const cached = cacheGet(ck, 7200000); // 2h cache
    if (cached) {
      console.log("Cache hit (pre)");
      return new Response(JSON.stringify(cached), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const fixturesData = await fetchWithAuth(`fixtures?date=${date}`, apiKey);
    let fixtures = fixturesData?.response || [];
    console.log(`Got ${fixtures.length} fixtures (pre)`);

    const preMatchStatuses = ['NS', 'TBD', 'SUSP', 'PST', 'CANC'];
    fixtures = fixtures.filter((f: any) => {
      const status = f.fixture?.status?.short || '';
      const isPreMatch = preMatchStatuses.includes(status);
      const isTargetLeague = LEAGUES_TO_ANALYZE.includes(f.league?.id);
      return isPreMatch && isTargetLeague;
    });
    console.log(`Filtered to ${fixtures.length} upcoming fixtures`);

    // Process matches sequentially in batches of 3 to respect API rate limits
    // Each match needs 2 team fetches, so batch of 3 = max 6 concurrent team requests
    const matches = [];
    for (let i = 0; i < fixtures.length; i += 3) {
      const batch = fixtures.slice(i, i + 3);
      const results = await Promise.all(
        batch.map((j: any) =>
          processMatch(j, apiKey).catch((e) => {
            console.error(`Match processing error:`, e);
            return {
              id: j.fixture.id, isLive: false, teams: j.teams, goals: j.goals,
              fixture: j.fixture, league: j.league?.name || '',
              homeStats: null, awayStats: null, stats: { home: null, away: null },
            };
          })
        )
      );
      matches.push(...results);
    }

    console.log(`Returning ${matches.length} matches`);
    const responseData = { matches };
    cacheSet(ck, responseData);
    return new Response(JSON.stringify(responseData), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("Edge function error:", err);
    return new Response(JSON.stringify({ matches: [], error: String(err) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
