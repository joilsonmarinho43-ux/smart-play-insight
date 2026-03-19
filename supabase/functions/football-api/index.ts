import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BASE_URL = "https://v3.football.api-sports.io";

const kv = await Deno.openKv();

async function fetchWithAuth(endpoint: string, apiKey: string) {
  const res = await fetch(`${BASE_URL}/${endpoint}`, {
    headers: { "x-apisports-key": apiKey },
  });
  if (!res.ok) throw new Error("Erro API");
  return res.json();
}

// =============================
// 🔥 EXTRAI STATS (LIVE)
// =============================
function extractStats(stats: any[]) {
  const get = (name: string) =>
    Number(stats.find((s: any) => s.type === name)?.value || 0);

  return {
    shotsOnGoal: get("Shots on Goal"),
    shotsOffGoal: get("Shots off Goal"),
    possession: get("Ball Possession"),
    corners: get("Corner Kicks"),
    attacks: get("Total Shots"),
    dangerousAttacks: get("Dangerous Attacks"),
  };
}

// =============================
// 🔥 NOVO: CALCULAR MÉDIA REAL
// =============================
function calcTeamStats(games: any[], teamId: number) {
  let goalsFor = 0;
  let goalsAgainst = 0;

  games.forEach((g) => {
    const isHome = g.teams.home.id === teamId;

    const scored = isHome ? g.goals.home : g.goals.away;
    const conceded = isHome ? g.goals.away : g.goals.home;

    goalsFor += scored || 0;
    goalsAgainst += conceded || 0;
  });

  return {
    goalsFor: goalsFor / games.length,
    goalsAgainst: goalsAgainst / games.length,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("API_FUTEBOL_KEY");
    const body = await req.json().catch(() => ({}));
    const isLive = body?.live || false;
    const date = body?.date || new Date().toISOString().split("T")[0];

    const cacheKey = isLive ? ["live"] : ["date", date];
    const cached = await kv.get(cacheKey);

    // CACHE INTELIGENTE
    if (cached.value) {
      const age = Date.now() - (cached.value.timestamp || 0);

      if (isLive && age < 15000) {
        return new Response(JSON.stringify(cached.value.data), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!isLive && age < 3600000) {
        return new Response(JSON.stringify(cached.value.data), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const endpoint = isLive ? "fixtures?live=all" : `fixtures?date=${date}`;
    const fixturesData = await fetchWithAuth(endpoint, apiKey);
    const fixtures = fixturesData?.response || [];

    const matches = await Promise.all(
      fixtures.map(async (j: any) => {
        const fixtureId = j.fixture.id;

        let statsHome = null;
        let statsAway = null;

        let homeStats = null;
        let awayStats = null;

        // =============================
        // 🔥 LIVE STATS
        // =============================
        if (isLive) {
          try {
            const statsData = await fetchWithAuth(
              `fixtures/statistics?fixture=${fixtureId}`,
              apiKey
            );

            const stats = statsData?.response || [];

            statsHome = extractStats(stats[0]?.statistics || []);
            statsAway = extractStats(stats[1]?.statistics || []);
          } catch {}
        }

        // =============================
        // 🔥 PRÉ-JOGO (BASE REAL)
        // =============================
        if (!isLive) {
          try {
            const [homeGames, awayGames] = await Promise.all([
              fetchWithAuth(
                `fixtures?team=${j.teams.home.id}&last=5&status=FT`,
                apiKey
              ),
              fetchWithAuth(
                `fixtures?team=${j.teams.away.id}&last=5&status=FT`,
                apiKey
              ),
            ]);

            homeStats = calcTeamStats(
              homeGames?.response || [],
              j.teams.home.id
            );

            awayStats = calcTeamStats(
              awayGames?.response || [],
              j.teams.away.id
            );
          } catch {
            // evita crash
          }
        }

        return {
          id: fixtureId,
          isLive: isLive,

          teams: j.teams,
          goals: j.goals,
          fixture: j.fixture,

          // 🔥 BASE DO BINGO REAL
          homeStats,
          awayStats,

          // 🔥 LIVE
          stats: {
            home: statsHome,
            away: statsAway,
          },
        };
      })
    );

    const response = {
      timestamp: Date.now(),
      data: { matches },
    };

    await kv.set(cacheKey, response);

    return new Response(JSON.stringify(response.data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ matches: [] }), { headers: corsHeaders });
  }
});
