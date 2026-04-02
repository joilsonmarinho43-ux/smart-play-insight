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
function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// Brasileirão A (71), Premier League (39), La Liga (140), Bundesliga (78), Serie A Italia (135), Ligue 1 (61)
const LEAGUES_TO_ANALYZE = [71, 39, 140, 78, 135, 61];
// Leagues worth fetching per-fixture stats for (live)
const LEAGUES_WITH_STATS = new Set([71, 39, 140, 78, 135, 61]);

const LEAGUE_DISPLAY_NAMES: Record<number, string> = {
  71: 'Brasileirão Série A',
  39: 'Premier League',
  140: 'La Liga',
  78: 'Bundesliga',
  135: 'Serie A (ITA)',
  61: 'Ligue 1',
};

function getLeagueDisplayName(leagueId: number, fallbackName: string): string {
  return LEAGUE_DISPLAY_NAMES[leagueId] || fallbackName;
}

async function fetchWithAuth(endpoint: string, apiKey: string): Promise<any> {
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

function getStat(stats: any[], name: string): number {
  const val = stats.find((s: any) => s.type === name)?.value;
  return val === null || val === undefined ? 0 : Number(String(val).replace('%', ''));
}

/**
 * NEW STRATEGY: Fetch last N finished fixtures PER LEAGUE (6 calls total)
 * then extract per-team stats from those results.
 * This replaces 46+ per-team API calls with just 6 league-level calls.
 */
async function fetchLeagueRecentFixtures(leagueId: number, apiKey: string): Promise<any[]> {
  const ck = `league_recent_${leagueId}`;
  const cached = cacheGet(ck, 3600000); // 1h cache
  if (cached) return cached;

  const year = new Date().getFullYear();
  let games: any[] = [];

  try {
    // Try current year season
    const data = await fetchWithAuth(
      `fixtures?league=${leagueId}&season=${year}&status=FT&last=50`, apiKey
    );
    games = data?.response || [];

    // If few results, also try previous season (European leagues use year-1)
    if (games.length < 20) {
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
  cacheSet(ck, games);
  return games;
}

/** Extract per-team stats from league fixture pool */
function calcTeamStatsFromPool(pool: any[], teamId: number): any {
  // Filter games where this team played, take most recent 5
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
  return {
    goalsFor: Number((goalsFor / count).toFixed(2)),
    goalsAgainst: Number((goalsAgainst / count).toFixed(2)),
    gamesCount: count,
    totalShots: 0,
    shotsOnGoal: 0,
    corners: 0,
    possession: 0,
    fouls: 0,
    yellowCards: 0,
    offsides: 0,
    bigChances: 0,
    recentGoalsFor,
    recentGoalsAgainst,
    _fixtureIds: teamGames.map((g: any) => g.fixture.id),
  };
}

/** Enrich team stats with detailed fixture statistics (fetched in background) */
async function enrichWithDetailedStats(
  stats: any, teamId: number, pool: any[], apiKey: string
): Promise<any> {
  if (!stats || !stats._fixtureIds) return stats;

  const teamGames = pool
    .filter((g: any) => g.teams.home.id === teamId || g.teams.away.id === teamId)
    .slice(0, 5);

  let totalShots = 0, shotsOnGoal = 0, corners = 0, possession = 0;
  let fouls = 0, yellowCards = 0, offsides = 0, bigChances = 0;
  let statsCount = 0;

  for (const g of teamGames) {
    const fId = g.fixture.id;
    const ck = `fstats_${fId}`;
    let fStats = cacheGet(ck, 86400000);

    if (!fStats) {
      try {
        const data = await fetchWithAuth(`fixtures/statistics?fixture=${fId}`, apiKey);
        fStats = data?.response || [];
        cacheSet(ck, fStats);
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
      // Only use cache if ALL matches have stats populated
      const cached = cacheGet("live_v3", 30000);
      if (cached) {
        const allHaveStats = cached.matches.every((m: any) => m.stats?.home !== null || m.stats?.away !== null);
        if (allHaveStats) {
          return new Response(JSON.stringify(cached), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        // If some matches lack stats, clear cache and re-fetch
        memCache.delete("live_v3");
      }

      const fixturesData = await fetchWithAuth("fixtures?live=all", apiKey);
      const fixtures = fixturesData?.response || [];
      console.log(`Live: ${fixtures.length} fixtures found`);

      const matches = [];

      // Process in batches of 3 with delays to avoid rate limiting
      for (let i = 0; i < fixtures.length; i++) {
        const j = fixtures[i];
        const fId = j.fixture.id;
        const elapsed = j.fixture?.status?.elapsed || 0;
        let stats = { home: null as any, away: null as any };

        // Per-fixture stats cache (30s TTL — short for live data freshness)
        const fStatsCk = `live_fstats_${fId}`;
        const cachedFStats = cacheGet(fStatsCk, 30000);

        if (cachedFStats) {
          stats = cachedFStats;
        } else {
          // Fetch fixture statistics
          try {
            const sData = await fetchWithAuth(`fixtures/statistics?fixture=${fId}`, apiKey);
            const resS = sData?.response || [];
            if (resS.length >= 2) {
              stats.home = extractStats(resS[0].statistics);
              stats.away = extractStats(resS[1].statistics);
            }
          } catch (e) { console.error(`Stats error for ${fId}:`, e); }

          // If stats are still null AND match has been running for 5+ mins, try events endpoint for corners only
          if (stats.home === null && stats.away === null && elapsed >= 5) {
            try {
              await delay(100);
              const evData = await fetchWithAuth(`fixtures/events?fixture=${fId}`, apiKey);
              const events = evData?.response || [];
              if (events.length > 0) {
                let homeCorners = 0, awayCorners = 0;
                const homeTeamId = j.teams?.home?.id;
                for (const ev of events) {
                  const isHome = ev.team?.id === homeTeamId;
                  if (ev.type === 'Corner' || ev.detail === 'Corner') {
                    if (isHome) homeCorners++; else awayCorners++;
                  }
                }
                // Only set corners from events - DO NOT fabricate other stats
                if (homeCorners > 0 || awayCorners > 0) {
                  stats.home = { shotsOnGoal: null, possession: null, corners: homeCorners, totalShots: null, dangerousAttacks: null };
                  stats.away = { shotsOnGoal: null, possession: null, corners: awayCorners, totalShots: null, dangerousAttacks: null };
                }
              }
            } catch (e) { console.error(`Events error for ${fId}:`, e); }
          }

          // Only cache if we got real data
          if (stats.home !== null || stats.away !== null) {
            cacheSet(fStatsCk, stats);
          }
        }

        matches.push({
          id: fId, isLive: true, teams: j.teams, goals: j.goals,
          fixture: j.fixture, league: getLeagueDisplayName(j.league?.id, j.league?.name || ''),
          homeStats: null, awayStats: null, stats,
        });

        // Rate limit: delay every 3 requests
        if ((i + 1) % 3 === 0 && i < fixtures.length - 1) {
          await delay(150);
        }
      }

      console.log(`Live: returning ${matches.length} matches, ${matches.filter((m: any) => m.stats?.home !== null).length} with stats`);
      const responseData = { matches };
      cacheSet("live_v3", responseData);
      return new Response(JSON.stringify(responseData), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ========== PRE-MATCH fixtures ==========
    const ck = `date_v14_${date}`;
    const cached = cacheGet(ck, 7200000);
    if (cached) {
      console.log("Cache hit (pre)");
      return new Response(JSON.stringify(cached), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Step 1: Get today's fixtures
    const fixturesData = await fetchWithAuth(`fixtures?date=${date}`, apiKey);
    let fixtures = fixturesData?.response || [];
    console.log(`Got ${fixtures.length} total fixtures`);

    fixtures = fixtures.filter((f: any) => {
      const status = f.fixture?.status?.short || '';
      return status === 'NS' && LEAGUES_TO_ANALYZE.includes(f.league?.id);
    });
    console.log(`Filtered to ${fixtures.length} target fixtures`);

    // Step 2: Identify which leagues we need data for
    const neededLeagues = new Set(fixtures.map((f: any) => f.league?.id).filter(Boolean));

    // Step 3: Fetch recent finished fixtures PER LEAGUE (max 6 API calls!)
    const leaguePools = new Map<number, any[]>();
    for (const leagueId of neededLeagues) {
      const pool = await fetchLeagueRecentFixtures(leagueId, apiKey);
      leaguePools.set(leagueId, pool);
      await delay(200);
    }

    // Step 4: Calculate basic team stats from league pools (NO extra API calls)
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

    // Step 5: Enrich with detailed fixture stats (uses cache, fetches only if needed)
    // Process sequentially with delays to respect rate limits
    for (const [teamId, stats] of teamStatsCache) {
      if (!stats) continue;
      const leagueId = fixtures.find(
        (f: any) => f.teams.home.id === teamId || f.teams.away.id === teamId
      )?.league?.id;
      const pool = leaguePools.get(leagueId) || [];
      const enriched = await enrichWithDetailedStats(stats, teamId, pool, apiKey);
      teamStatsCache.set(teamId, enriched);
    }

    // Step 6: Assemble matches
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

    console.log(`Returning ${matches.length} matches with stats`);
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
