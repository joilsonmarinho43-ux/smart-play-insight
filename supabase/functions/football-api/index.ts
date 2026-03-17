import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BASE_URL = "https://v3.football.api-sports.io";

// Ligas principais + Brasil + Competições relevantes
const LIGAS_ALVO_IDS = [39, 140, 78, 135, 61, 71, 72, 73, 13, 11, 2, 848];

// ===============================
// 🔌 FETCH COM AUTENTICAÇÃO
// ===============================
async function fetchWithAuth(endpoint: string, apiKey: string) {
  const res = await fetch(`${BASE_URL}/${endpoint}`, {
    headers: {
      "x-apisports-key": apiKey, // 🔥 HEADER CORRETO
    },
  });

  if (!res.ok) {
    throw new Error("Erro na API externa");
  }

  return res.json();
}

// ===============================
// 📊 MÉDIA PONDERADA
// ===============================
function calculateWeightedValue(results: number[]) {
  if (!results.length) return 0;
  const weights = results.map((_, i) => i + 1);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const weightedSum = results.reduce((sum, val, i) => sum + val * weights[i], 0);
  return parseFloat((weightedSum / totalWeight).toFixed(2));
}

// ===============================
// 🚀 SERVER
// ===============================
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("API_FUTEBOL_KEY");
    if (!apiKey) throw new Error("API Key não configurada");

    // 🔥 BODY BLINDADO
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const live = body?.live === true;
    const date = body?.date;

    let endpoint = "";

    // =========================
    // 🔥 LIVE
    // =========================
    if (live) {
      endpoint = "fixtures?live=all";
    }

    // =========================
    // 📅 PRÉ-JOGO
    // =========================
    else if (date) {
      endpoint = `fixtures?date=${date}`;
    }

    // =========================
    // 🛡️ FALLBACK
    // =========================
    else {
      const today = new Date().toISOString().split("T")[0];
      endpoint = `fixtures?date=${today}`;
    }

    const fixturesData = await fetchWithAuth(endpoint, apiKey);
    const allFixtures = fixturesData.response || [];

    const filtered = allFixtures.filter((f: any) =>
      LIGAS_ALVO_IDS.includes(f.league.id)
    );

    if (filtered.length === 0) {
      return new Response(JSON.stringify({ matches: [] }), {
        headers: corsHeaders,
      });
    }

    const matches = await Promise.all(
      filtered.map(async (j: any) => {

        // =========================
        // 🔴 LIVE (LEVE E RÁPIDO)
        // =========================
        if (live) {
          return {
            id: String(j.fixture.id),
            time: j.fixture.status.elapsed || 0,
            league: j.league.name,
            homeTeam: j.teams.home.name,
            awayTeam: j.teams.away.name,
            status: j.fixture.status.short,
            goalsHome: j.goals.home,
            goalsAway: j.goals.away,
          };
        }

        // =========================
        // 📊 PRÉ-JOGO (COMPLETO)
        // =========================
        const [hForm, aForm] = await Promise.all([
          fetchWithAuth(
            `fixtures?team=${j.teams.home.id}&last=7&status=FT`,
            apiKey
          ),
          fetchWithAuth(
            `fixtures?team=${j.teams.away.id}&last=7&status=FT`,
            apiKey
          ),
        ]);

        const hGoals = (hForm.response || []).map((f: any) =>
          f.teams.home.id === j.teams.home.id ? f.goals.home : f.goals.away
        );

        const aGoals = (aForm.response || []).map((f: any) =>
          f.teams.away.id === j.teams.away.id ? f.goals.home : f.goals.away
        );

        return {
          id: String(j.fixture.id),
          time: j.fixture.date.split("T")[1].substring(0, 5),
          league: j.league.name,
          homeTeam: j.teams.home.name,
          awayTeam: j.teams.away.name,
          status: j.fixture.status.short,
          metrics: {
            goals: [
              calculateWeightedValue(hGoals),
              calculateWeightedValue(aGoals),
            ],
            corners: [5.5, 4.8],
          },
          predictions: {
            homeWin: "Analizando...",
            draw: "---",
            awayWin: "---",
          },
        };
      })
    );

    return new Response(JSON.stringify({ matches }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message, matches: [] }),
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  }
});
