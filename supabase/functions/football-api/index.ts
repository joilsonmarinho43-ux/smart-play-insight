import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BASE_URL = "https://v3.football.api-sports.io";
const memCache = new Map<string, { timestamp: number; data: any }>();

function cacheGet(key: string) {
  return memCache.get(key) || null;
}
function cacheSet(key: string, value: { timestamp: number; data: any }) {
  memCache.set(key, value);
}

const LEAGUES_TO_ANALYZE = [13, 71, 72, 39, 140, 78, 135, 94, 2, 3, 848];

async function processInBatches<T, R>(
  items: T[],
  batchSize: number,
  delayMs: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    if (i + batchSize < items.length) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return results;
}

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

function calcTeamStats(games: any[], teamId: number) {
  if (!games || games.length === 0) return {
    goalsFor: 0, goalsAgainst: 0, gamesCount: 0,
    shotsOnGoal: 0, totalShots: 0, corners: 0, possession: 0,
    fouls: 0, yellowCards: 0, offsides: 0, bigChances: 0,
  };

  let goalsFor = 0, goalsAgainst = 0;
  games.forEach((g) => {
    const isHome = g.teams.home.id === teamId;
    goalsFor += (isHome ? g.goals.home : g.goals.away) || 0;
    goalsAgainst += (isHome ? g.goals.away : g.goals.home) || 0;
  });

  const count = games.length;
  return {
    goalsFor: Number((goalsFor / count).toFixed(2)),
    goalsAgainst: Number((goalsAgainst / count).toFixed(2)),
    gamesCount: count,
    // Placeholders - will be filled by per-fixture stats
    shotsOnGoal: 0,
    totalShots: 0,
    corners: 0,
    possession: 0,
    fouls: 0,
    yellowCards: 0,
    offsides: 0,
    bigChances: 0,
  };
}

// Fetch detailed stats for a list of fixture IDs and average them for a specific team
async function fetchDetailedStats(fixtureIds: number[], teamId: number, apiKey: string) {
  const allStats: any[] = [];

  // Process 3 at a time with 1s delay
  for (let i = 0; i < fixtureIds.length; i += 3) {
    const batch = fixtureIds.slice(i, i + 3);
    const results = await Promise.all(batch.map(async (fId) => {
      try {
        const data = await fetchWithAuth(`fixtures/statistics?fixture=${fId}`, apiKey);
        const response = data?.response || [];
        // Find the stats for our team
        const teamStats = response.find((r: any) => r.team?.id === teamId);
        if (teamStats?.statistics) {
          const get = (name: string) => {
            const val = teamStats.statistics.find((s: any) => s.type === name)?.value;
            return val === null || val === undefined ? 0 : Number(String(val).replace('%', ''));
          };
          return {
            shotsOnGoal: get("Shots on Goal"),
            totalShots: get("Total Shots"),
            corners: get("Corner Kicks"),
            possession: get("Ball Possession"),
            fouls: get("Fouls"),
            yellowCards: get("Yellow Cards"),
            offsides: get("Offsides"),
            bigChances: get("expected_goals") ? get("expected_goals") : 0,
          };
        }
      } catch (e) {
        console.error(`Stats fetch error for fixture ${fId}:`, e);
      }
      return null;
    }));
    allStats.push(...results.filter(Boolean));
    if (i + 3 < fixtureIds.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  if (allStats.length === 0) return null;

  const avg = (key: string) => {
    const sum = allStats.reduce((acc, s) => acc + (s[key] || 0), 0);
    return Number((sum / allStats.length).toFixed(1));
  };

  return {
    shotsOnGoal: avg('shotsOnGoal'),
    totalShots: avg('totalShots'),
    corners: avg('corners'),
    possession: avg('possession'),
    fouls: avg('fouls'),
    yellowCards: avg('yellowCards'),
    offsides: avg('offsides'),
    bigChances: avg('bigChances'),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("API_FUTEBOL_KEY");
    if (!apiKey) {
      console.error("API_FUTEBOL_KEY not set");
      return new Response(JSON.stringify({ error: "API key missing", matches: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({}));
    const isLive = body?.live === true;
    const fixtureId = body?.fixture;
    const date = body?.date || new Date().toISOString().split("T")[0];

    // ========== STATS for a specific fixture ==========
    if (fixtureId) {
      console.log(`Fetching stats for fixture: ${fixtureId}`);
      const ck = `stats_${fixtureId}`;
      const cached = cacheGet(ck);
      const now = Date.now();

      if (cached && (now - cached.timestamp < 20000)) {
        return new Response(JSON.stringify(cached.data), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const sData = await fetchWithAuth(`fixtures/statistics?fixture=${fixtureId}`, apiKey);
      const responseData = { response: sData?.response || [] };
      cacheSet(ck, { timestamp: now, data: responseData });

      return new Response(JSON.stringify(responseData), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ========== LIVE or PRE-MATCH fixtures ==========
    const ck2 = isLive ? "live_v3" : `date_v4_${date}`;
    const cached2 = cacheGet(ck2);
    const now = Date.now();

    if (cached2) {
      const age = now - (cached2.timestamp || 0);
      const ttl = isLive ? 15000 : 3600000;
      if (age < ttl) {
        console.log(`Cache hit (${isLive ? 'live' : 'pre'})`);
        return new Response(JSON.stringify(cached2.data), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const endpoint = isLive ? "fixtures?live=all" : `fixtures?date=${date}`;
    console.log(`Fetching: ${endpoint}`);
    const fixturesData = await fetchWithAuth(endpoint, apiKey);
    let fixtures = fixturesData?.response || [];
    console.log(`Got ${fixtures.length} fixtures (${isLive ? 'live' : 'pre'})`);

    if (!isLive) {
      const preMatchStatuses = ['NS', 'TBD', 'SUSP', 'PST', 'CANC'];
      fixtures = fixtures.filter((f: any) => {
        const status = f.fixture?.status?.short || '';
        const isPreMatch = preMatchStatuses.includes(status);
        const isTargetLeague = LEAGUES_TO_ANALYZE.includes(f.league?.id) || f.league?.country === "Brazil";
        return isPreMatch && isTargetLeague;
      }).slice(0, 20);
      console.log(`Filtered to ${fixtures.length} upcoming fixtures`);
    }

    // Process in batches of 2 fixtures with 1.5s delay
    const matches = await processInBatches(fixtures, 2, 1500, async (j: any) => {
      const fId = j.fixture.id;
      let stats = { home: null as any, away: null as any };
      let hStats = null as any, aStats = null as any;
      let hDetailed = null as any, aDetailed = null as any;

      if (isLive) {
        try {
          const sData = await fetchWithAuth(`fixtures/statistics?fixture=${fId}`, apiKey);
          const resS = sData?.response || [];
          if (resS.length >= 2) {
            stats.home = extractStats(resS[0].statistics);
            stats.away = extractStats(resS[1].statistics);
          }
        } catch (e) { console.error(`Stats error for ${fId}:`, e); }
      } else {
        // Fetch last 5 games for each team
        let homeFixtureIds: number[] = [];
        let awayFixtureIds: number[] = [];

        try {
          const hG = await fetchWithAuth(`fixtures?team=${j.teams.home.id}&last=5&status=FT`, apiKey);
          const homeGames = hG?.response || [];
          hStats = calcTeamStats(homeGames, j.teams.home.id);
          homeFixtureIds = homeGames.map((g: any) => g.fixture.id);
          console.log(`Team ${j.teams.home.name}: GF=${hStats.goalsFor}, GA=${hStats.goalsAgainst}, games=${homeGames.length}`);
        } catch (e) { console.error(`Home stats error for ${j.teams.home.name}:`, e); }

        try {
          const aG = await fetchWithAuth(`fixtures?team=${j.teams.away.id}&last=5&status=FT`, apiKey);
          const awayGames = aG?.response || [];
          aStats = calcTeamStats(awayGames, j.teams.away.id);
          awayFixtureIds = awayGames.map((g: any) => g.fixture.id);
          console.log(`Team ${j.teams.away.name}: GF=${aStats.goalsFor}, GA=${aStats.goalsAgainst}, games=${awayGames.length}`);
        } catch (e) { console.error(`Away stats error for ${j.teams.away.name}:`, e); }

        // Fetch detailed stats from fixture statistics for each team's last 5 games
        try {
          if (homeFixtureIds.length > 0) {
            hDetailed = await fetchDetailedStats(homeFixtureIds, j.teams.home.id, apiKey);
            if (hDetailed && hStats) {
              Object.assign(hStats, hDetailed);
            }
          }
        } catch (e) { console.error(`Home detailed stats error:`, e); }

        try {
          if (awayFixtureIds.length > 0) {
            aDetailed = await fetchDetailedStats(awayFixtureIds, j.teams.away.id, apiKey);
            if (aDetailed && aStats) {
              Object.assign(aStats, aDetailed);
            }
          }
        } catch (e) { console.error(`Away detailed stats error:`, e); }
      }

      return {
        id: fId,
        isLive,
        teams: j.teams,
        goals: j.goals,
        fixture: j.fixture,
        league: j.league?.name || '',
        homeStats: hStats,
        awayStats: aStats,
        stats,
      };
    });

    console.log(`Returning ${matches.length} matches`);
    const responseData = { matches };
    cacheSet(ck2, { timestamp: now, data: responseData });

    return new Response(JSON.stringify(responseData), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("Edge function error:", err);
    return new Response(JSON.stringify({ matches: [], error: String(err) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
