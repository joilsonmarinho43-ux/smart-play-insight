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

async function fetchWithAuth(endpoint: string, apiKey: string, retries = 1): Promise<any> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await delay(300);
    console.log(`API call: ${endpoint}${attempt > 0 ? ` (retry ${attempt})` : ''}`);
    const res = await fetch(`${BASE_URL}/${endpoint}`, {
      headers: { "x-apisports-key": apiKey },
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`API error ${res.status}: ${text}`);
      if (attempt === retries) throw new Error(`API ${res.status}`);
      continue;
    }
    const json = await res.json();
    // Check for rate limit (API returns empty response array when limited)
    return json;
  }
}

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

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

/** Fetch team stats with cache — single API call using season + status */
async function fetchTeamStats(teamId: number, teamName: string, apiKey: string): Promise<any> {
  const ck = `team_detailed_v2_${teamId}`;
  const cached = cacheGet(ck, 7200000);
  if (cached) return cached;

  try {
    const currentYear = new Date().getFullYear();
    // European leagues use previous year as season (2025 for 2025-2026)
    // Brazilian league uses current year (2026 for 2026 season)
    // Try both: current year first, then previous
    let games: any[] = [];
    
    const data1 = await fetchWithAuth(`fixtures?team=${teamId}&season=${currentYear}&status=FT&last=5`, apiKey);
    games = data1?.response || [];
    
    if (games.length < 3) {
      await delay(100);
      const data2 = await fetchWithAuth(`fixtures?team=${teamId}&season=${currentYear - 1}&status=FT&last=5`, apiKey);
      const moreGames = data2?.response || [];
      // Merge and keep most recent 5
      games = [...games, ...moreGames].slice(0, 5);
    }
    
    console.log(`Team ${teamName} (${teamId}): ${games.length} finished games`);
    if (games.length === 0) return null;
    
    const stats = await calcTeamStatsDetailed(games, teamId, apiKey);
    cacheSet(ck, stats);
    return stats;
  } catch (e) {
    console.error(`Team ${teamName} error:`, e);
    return null;
  }
}

/** Pre-fetch all unique teams sequentially to avoid rate limits */
async function prefetchAllTeams(fixtures: any[], apiKey: string) {
  // Collect unique team IDs
  const teamMap = new Map<number, string>();
  for (const f of fixtures) {
    teamMap.set(f.teams.home.id, f.teams.home.name);
    teamMap.set(f.teams.away.id, f.teams.away.name);
  }
  
  console.log(`Pre-fetching stats for ${teamMap.size} unique teams`);
  const results = new Map<number, any>();
  
  // Process teams sequentially with small delay to respect rate limits
  let count = 0;
  for (const [teamId, teamName] of teamMap) {
    // Check cache first - no delay needed for cached teams
    const ck = `team_detailed_v2_${teamId}`;
    const cached = cacheGet(ck, 7200000);
    if (cached) {
      results.set(teamId, cached);
      continue;
    }
    
    // Add delay between actual API calls (not cached)
    if (count > 0) await delay(120);
    const stats = await fetchTeamStats(teamId, teamName, apiKey);
    results.set(teamId, stats);
    count++;
  }
  
  console.log(`Fetched ${count} teams from API, ${teamMap.size - count} from cache`);
  return results;
}

// ========== PRE-MATCH section updated in serve() below ==========

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
