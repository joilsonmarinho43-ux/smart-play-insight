import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BASE_URL = "https://v3.football.api-sports.io";
const memCache = new Map<string, { timestamp: number; data: any }>();

function cacheGet(key: string) { return memCache.get(key) || null; }
function cacheSet(key: string, value: { timestamp: number; data: any }) { memCache.set(key, value); }

const LEAGUES_TO_ANALYZE = [13, 71, 72, 39, 140, 78, 135, 94, 2, 3, 848];

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
    shotsOnGoal: 0, totalShots: 0, corners: 0, possession: 0,
    fouls: 0, yellowCards: 0, offsides: 0, bigChances: 0,
  };
}

// Fetch detailed stats for fixture IDs — only use first 2 to reduce API calls
async function fetchDetailedStats(fixtureIds: number[], teamId: number, apiKey: string) {
  const idsToFetch = fixtureIds.slice(0, 2);
  const allStats: any[] = [];

  for (const fId of idsToFetch) {
    const ck = `fstat_${fId}_${teamId}`;
    const cached = cacheGet(ck);
    if (cached && (Date.now() - cached.timestamp < 3600000)) {
      allStats.push(cached.data);
      continue;
    }

    try {
      const data = await fetchWithAuth(`fixtures/statistics?fixture=${fId}`, apiKey);
      const response = data?.response || [];
      const teamStats = response.find((r: any) => r.team?.id === teamId);
      if (teamStats?.statistics) {
        const get = (name: string) => {
          const val = teamStats.statistics.find((s: any) => s.type === name)?.value;
          return val === null || val === undefined ? 0 : Number(String(val).replace('%', ''));
        };
        const parsed = {
          shotsOnGoal: get("Shots on Goal"),
          totalShots: get("Total Shots"),
          corners: get("Corner Kicks"),
          possession: get("Ball Possession"),
          fouls: get("Fouls"),
          yellowCards: get("Yellow Cards"),
          offsides: get("Offsides"),
          bigChances: get("Expected Goals") || 0,
        };
        cacheSet(ck, { timestamp: Date.now(), data: parsed });
        allStats.push(parsed);
      }
    } catch (e) {
      console.error(`Stats fetch error for fixture ${fId}:`, e);
    }
    await new Promise(r => setTimeout(r, 250));
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

// Process a single match with reduced API calls
async function processMatch(j: any, apiKey: string) {
  const fId = j.fixture.id;
  let hStats = null as any, aStats = null as any;

  try {
    const hG = await fetchWithAuth(`fixtures?team=${j.teams.home.id}&last=5&status=FT`, apiKey);
    const homeGames = hG?.response || [];
    hStats = calcTeamStats(homeGames, j.teams.home.id);
    const homeFixtureIds = homeGames.map((g: any) => g.fixture.id);

    const hDetailed = await fetchDetailedStats(homeFixtureIds, j.teams.home.id, apiKey);
    if (hDetailed) Object.assign(hStats, hDetailed);
  } catch (e) { console.error(`Home error ${j.teams.home.name}:`, e); }

  await new Promise(r => setTimeout(r, 300));

  try {
    const aG = await fetchWithAuth(`fixtures?team=${j.teams.away.id}&last=5&status=FT`, apiKey);
    const awayGames = aG?.response || [];
    aStats = calcTeamStats(awayGames, j.teams.away.id);
    const awayFixtureIds = awayGames.map((g: any) => g.fixture.id);

    const aDetailed = await fetchDetailedStats(awayFixtureIds, j.teams.away.id, apiKey);
    if (aDetailed) Object.assign(aStats, aDetailed);
  } catch (e) { console.error(`Away error ${j.teams.away.name}:`, e); }

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
      const ck = `stats_${fixtureId}`;
      const cached = cacheGet(ck);
      if (cached && (Date.now() - cached.timestamp < 20000)) {
        return new Response(JSON.stringify(cached.data), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const sData = await fetchWithAuth(`fixtures/statistics?fixture=${fixtureId}`, apiKey);
      const responseData = { response: sData?.response || [] };
      cacheSet(ck, { timestamp: Date.now(), data: responseData });
      return new Response(JSON.stringify(responseData), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ========== LIVE or PRE-MATCH fixtures ==========
    const ck2 = isLive ? "live_v3" : `date_v5_${date}`;
    const cached2 = cacheGet(ck2);

    if (cached2) {
      const age = Date.now() - (cached2.timestamp || 0);
      const ttl = isLive ? 15000 : 3600000;
      if (age < ttl) {
        console.log(`Cache hit (${isLive ? 'live' : 'pre'})`);
        return new Response(JSON.stringify(cached2.data), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const endpoint = isLive ? "fixtures?live=all" : `fixtures?date=${date}`;
    const fixturesData = await fetchWithAuth(endpoint, apiKey);
    let fixtures = fixturesData?.response || [];
    console.log(`Got ${fixtures.length} fixtures (${isLive ? 'live' : 'pre'})`);

    if (isLive) {
      // Live: just fetch stats for each fixture
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
      cacheSet(ck2, { timestamp: Date.now(), data: responseData });
      return new Response(JSON.stringify(responseData), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Pre-match: filter and process sequentially
    const preMatchStatuses = ['NS', 'TBD', 'SUSP', 'PST', 'CANC'];
    fixtures = fixtures.filter((f: any) => {
      const status = f.fixture?.status?.short || '';
      const isPreMatch = preMatchStatuses.includes(status);
      const isTargetLeague = LEAGUES_TO_ANALYZE.includes(f.league?.id) || f.league?.country === "Brazil";
      return isPreMatch && isTargetLeague;
    }).slice(0, 15);
    console.log(`Filtered to ${fixtures.length} upcoming fixtures`);

    // Process matches ONE AT A TIME to avoid rate limits
    const matches = [];
    for (const j of fixtures) {
      try {
        const match = await processMatch(j, apiKey);
        matches.push(match);
      } catch (e) {
        console.error(`Match processing error:`, e);
        matches.push({
          id: j.fixture.id, isLive: false, teams: j.teams, goals: j.goals,
          fixture: j.fixture, league: j.league?.name || '',
          homeStats: null, awayStats: null, stats: { home: null, away: null },
        });
      }
      // Pause between matches
      await new Promise(r => setTimeout(r, 300));
    }

    console.log(`Returning ${matches.length} matches`);
    const responseData = { matches };
    cacheSet(ck2, { timestamp: Date.now(), data: responseData });
    return new Response(JSON.stringify(responseData), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("Edge function error:", err);
    return new Response(JSON.stringify({ matches: [], error: String(err) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
