import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BASE_URL = "https://v3.football.api-sports.io";

const LIGAS_ALVO_IDS = [
  39, 140, 78, 135, 61, 94, 88, 253, 2, 71, 218, 144, 119, 262, 73
];

async function apiGet(endpoint: string, params: Record<string, string>, apiKey: string) {
  const url = new URL(`${BASE_URL}/${endpoint}`);

  Object.entries(params).forEach(([k, v]) => {
    url.searchParams.set(k, v);
  });

  const res = await fetch(url.toString(), {
    headers: {
      "x-rapidapi-key": apiKey,
      "x-rapidapi-host": "v3.football.api-sports.io",
    },
  });

  const json = await res.json();
  return json.response || [];
}

function f1(v: number) {
  return parseFloat(v.toFixed(1));
}

function f2(v: number) {
  return parseFloat(v.toFixed(2));
}

function calcVariance(values: number[]) {
  if (values.length < 2) return 0;

  const mean = values.reduce((a, b) => a + b, 0) / values.length;

  return (
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) /
    (values.length - 1)
  );
}

function extractStatValue(stats: any[], type: string) {
  if (!stats) return 0;

  const stat = stats.find((s: any) => s.type === type);

  if (!stat || stat.value === null) return 0;

  const val =
    typeof stat.value === "string"
      ? parseFloat(stat.value.replace("%", ""))
      : stat.value;

  return isNaN(val) ? 0 : val;
}

/* média ponderada → jogos recentes valem mais */
function weightedAverage(values: number[]) {
  if (!values || values.length === 0) return 0;

  let weightedSum = 0;
  let weightTotal = 0;

  for (let i = 0; i < values.length; i++) {
    const weight = i + 1;

    weightedSum += values[i] * weight;
    weightTotal += weight;
  }

  return weightedSum / weightTotal;
}

async function getRecentForm(teamId: number, count: number, apiKey: string) {
  const fixtures = await apiGet(
    "fixtures",
    {
      team: String(teamId),
      last: String(count),
      status: "FT",
    },
    apiKey
  );

  const goals: number[] = [];
  const corners: number[] = [];
  const cards: number[] = [];
  const shots: number[] = [];
  const shotsOnTarget: number[] = [];

  for (const f of fixtures) {
    const isHome = f.teams.home.id === teamId;

    goals.push(isHome ? f.goals.home || 0 : f.goals.away || 0);

    try {
      const stats = await apiGet(
        "fixtures/statistics",
        { fixture: String(f.fixture.id) },
        apiKey
      );

      const teamStats = isHome
        ? stats?.[0]?.statistics
        : stats?.[1]?.statistics;

      if (teamStats) {
        corners.push(extractStatValue(teamStats, "Corner Kicks"));

        shots.push(extractStatValue(teamStats, "Total Shots"));

        shotsOnTarget.push(
          extractStatValue(teamStats, "Shots on Goal")
        );

        const yellow = extractStatValue(teamStats, "Yellow Cards");
        const red = extractStatValue(teamStats, "Red Cards");

        cards.push(yellow + red);
      }
    } catch {
      corners.push(0);
      shots.push(0);
      shotsOnTarget.push(0);
      cards.push(0);
    }
  }

  const avg = (arr: number[]) => weightedAverage(arr);

  return {
    goals,
    corners,
    cards,
    shots,
    shotsOnTarget,

    avgGoals: avg(goals),
    avgCorners: avg(corners),
    avgCards: avg(cards),
    avgShots: avg(shots),
    avgShotsOnTarget: avg(shotsOnTarget),

    gamesTotal: fixtures.length,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  const apiKey = Deno.env.get("API_FUTEBOL_KEY");

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "API key missing" }),
      { headers: corsHeaders }
    );
  }

  try {
    const { date } = await req.json();

    const fixtures = await apiGet(
      "fixtures",
      { date },
      apiKey
    );

    const jogos = fixtures.filter((j: any) =>
      LIGAS_ALVO_IDS.includes(j.league.id)
    );

    const matches = [];

    for (const jogo of jogos.slice(0, 25)) {
      const homeId = jogo.teams.home.id;
      const awayId = jogo.teams.away.id;

      const homeForm = await getRecentForm(homeId, 7, apiKey);
      const awayForm = await getRecentForm(awayId, 7, apiKey);

      matches.push({
        league: jogo.league.name,

        homeTeam: jogo.teams.home.name,
        awayTeam: jogo.teams.away.name,

        metrics: {
          goals: [
            f1(homeForm.avgGoals),
            f1(awayForm.avgGoals),
          ],

          corners: [
            f1(homeForm.avgCorners),
            f1(awayForm.avgCorners),
          ],

          cards: [
            f1(homeForm.avgCards),
            f1(awayForm.avgCards),
          ],
        },

        variance: {
          cornersHome: calcVariance(homeForm.corners),
          cornersAway: calcVariance(awayForm.corners),
        },
      });
    }

    return new Response(JSON.stringify({ matches }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "processing error" }),
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
});
