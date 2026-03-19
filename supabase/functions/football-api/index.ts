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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("API_FUTEBOL_KEY");
    const body = await req.json().catch(() => ({}));
    const isLive = body?.live || false;
    const date = body?.date || new Date().toISOString().split("T")[0];

    const cacheKey = isLive ? ["live"] : ["date", date];
    const cached = await kv.get(cacheKey);

    // 🔥 CACHE DIFERENTE PRA LIVE
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

    // 🔥 BUSCA CORRETA
    const endpoint = isLive ? "fixtures?live=all" : `fixtures?date=${date}`;
    const fixturesData = await fetchWithAuth(endpoint, apiKey);
    const fixtures = fixturesData?.response || [];

    const matches = await Promise.all(
      fixtures.map(async (j: any) => {
        const fixtureId = j.fixture.id;

        let statsHome = null;
        let statsAway = null;

        // 🔥 SÓ PEGA STATS SE FOR LIVE
        if (isLive) {
          try {
            const statsData = await fetchWithAuth(`fixtures/statistics?fixture=${fixtureId}`, apiKey);

            const stats = statsData?.response || [];

            statsHome = extractStats(stats[0]?.statistics || []);
            statsAway = extractStats(stats[1]?.statistics || []);
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
