import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BASE_URL = "https://v3.football.api-sports.io";
const kv = await Deno.openKv();

// 🔥 Ligas Principais para economizar sua API Pro (Adicione IDs conforme necessário)
const LEAGUES_TO_ANALYZE = [13, 71, 72, 39, 140, 78, 135, 94, 2, 3, 848]; 

async function fetchWithAuth(endpoint: string, apiKey: string) {
  const res = await fetch(`${BASE_URL}/${endpoint}`, {
    headers: { "x-apisports-key": apiKey },
  });
  if (!res.ok) throw new Error("Erro API");
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
  if (!games || games.length === 0) return { goalsFor: 0, goalsAgainst: 0 };
  let goalsFor = 0;
  let goalsAgainst = 0;

  games.forEach((g) => {
    const isHome = g.teams.home.id === teamId;
    goalsFor += (isHome ? g.goals.home : g.goals.away) || 0;
    goalsAgainst += (isHome ? g.goals.away : g.goals.home) || 0;
  });

  return {
    goalsFor: Number((goalsFor / games.length).toFixed(2)),
    goalsAgainst: Number((goalsAgainst / games.length).toFixed(2)),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("API_FUTEBOL_KEY");
    const body = await req.json().catch(() => ({}));
    const isLive = body?.live || false;
    const date = body?.date || new Date().toISOString().split("T")[0];

    // Cache: 15s para Live, 1h para Pré-jogo
    const cacheKey = isLive ? ["live_v2"] : ["date_v2", date];
    const cached = await kv.get(cacheKey);
    const now = Date.now();

    if (cached.value) {
      const age = now - (cached.value.timestamp || 0);
      const ttl = isLive ? 15000 : 3600000;
      if (age < ttl) return new Response(JSON.stringify(cached.value.data), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Busca Fixtures
    const endpoint = isLive ? "fixtures?live=all" : `fixtures?date=${date}`;
    const fixturesData = await fetchWithAuth(endpoint, apiKey);
    let fixtures = fixturesData?.response || [];

    // Filtro Profissional: Reduz o loop para não travar a memória
    if (!isLive) {
      fixtures = fixtures.filter((f: any) => LEAGUES_TO_ANALYZE.includes(f.league.id) || f.league.country === "Brazil").slice(0, 40);
    }

    const matches = await Promise.all(
      fixtures.map(async (j: any) => {
        const fixtureId = j.fixture.id;
        let stats = { home: null, away: null };
        let hStats = null, aStats = null;

        if (isLive) {
          try {
            const sData = await fetchWithAuth(`fixtures/statistics?fixture=${fixtureId}`, apiKey);
            const resS = sData?.response || [];
            if (resS.length >= 2) {
              stats.home = extractStats(resS[0].statistics);
              stats.away = extractStats(resS[1].statistics);
            }
          } catch (e) { console.error(`Erro Stats Live ${fixtureId}`); }
        } else {
          try {
            const [hG, aG] = await Promise.all([
              fetchWithAuth(`fixtures?team=${j.teams.home.id}&last=8&status=FT`, apiKey),
              fetchWithAuth(`fixtures?team=${j.teams.away.id}&last=8&status=FT`, apiKey),
            ]);
            hStats = calcTeamStats(hG?.response || [], j.teams.home.id);
            aStats = calcTeamStats(aG?.response || [], j.teams.away.id);
          } catch (e) {}
        }

        return {
          id: fixtureId,
          isLive,
          teams: j.teams,
          goals: j.goals,
          fixture: j.fixture,
          league: j.league.name,
          homeStats: hStats,
          awayStats: aStats,
          stats: stats,
        };
      })
    );

    const responseData = { matches };
    await kv.set(cacheKey, { timestamp: now, data: responseData });

    return new Response(JSON.stringify(responseData), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ matches: [] }), { headers: corsHeaders });
  }
});
