import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BASE_URL = "https://v3.football.api-sports.io";

const LIGAS_ALVO_IDS = [39, 140, 78, 135, 61, 94, 88, 253, 2];

async function apiGet(endpoint: string, params: Record<string, string>, apiKey: string) {
  const url = new URL(`${BASE_URL}/${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: {
      "x-rapidapi-key": apiKey,
      "x-rapidapi-host": "v3.football.api-sports.io",
    },
  });
  const json = await res.json();
  return json.response || [];
}

async function getTeamSeasonStats(teamId: number, leagueId: number, season: number, apiKey: string) {
  const stats = await apiGet("teams/statistics", {
    team: String(teamId),
    league: String(leagueId),
    season: String(season),
  }, apiKey);

  try {
    const played = stats.fixtures?.played?.total || 1;
    return {
      corners_for: (stats.corners?.for?.total || 0) / played,
      corners_against: (stats.corners?.against?.total || 0) / played,
      cards_avg: ((stats.cards?.yellow?.total || 0) + (stats.cards?.red?.total || 0)) / played,
    };
  } catch {
    return { corners_for: 0, corners_against: 0, cards_avg: 0 };
  }
}

async function getLast5Stats(teamId: number, apiKey: string) {
  const fixtures = await apiGet("fixtures", { team: String(teamId), last: "5" }, apiKey);
  let totalCorners = 0, totalCards = 0, jogos = 0;

  for (const f of fixtures) {
    const stats = await apiGet("fixtures/statistics", { fixture: String(f.fixture.id) }, apiKey);
    if (stats && stats.length) {
      jogos++;
      for (const team of stats) {
        for (const s of team.statistics) {
          if (s.type === "Corner Kicks") totalCorners += s.value || 0;
          if (s.type === "Yellow Cards") totalCards += s.value || 0;
          if (s.type === "Red Cards") totalCards += s.value || 0;
        }
      }
    }
  }
  return jogos > 0 ? [totalCorners / jogos, totalCards / jogos] : [0, 0];
}

async function getFixtureStats(fixtureId: number, apiKey: string) {
  const stats = await apiGet("fixtures/statistics", { fixture: String(fixtureId) }, apiKey);
  
  const result: Record<string, [number, number]> = {
    possession: [0, 0],
    totalShots: [0, 0],
    shotsOnTarget: [0, 0],
    fouls: [0, 0],
    offsides: [0, 0],
  };

  if (stats && stats.length >= 2) {
    for (let i = 0; i < 2; i++) {
      for (const s of stats[i].statistics) {
        const v = typeof s.value === "string" ? parseFloat(s.value) : (s.value || 0);
        switch (s.type) {
          case "Ball Possession": result.possession[i] = v; break;
          case "Total Shots": result.totalShots[i] = v; break;
          case "Shots on Goal": result.shotsOnTarget[i] = v; break;
          case "Fouls": result.fouls[i] = v; break;
          case "Offsides": result.offsides[i] = v; break;
        }
      }
    }
  }
  return result;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const apiKey = Deno.env.get("API_FUTEBOL_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "API key not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { date } = await req.json();
    if (!date) throw new Error("Date required");

    const fixtures = await apiGet("fixtures", { date }, apiKey);
    const jogos = fixtures.filter((j: any) => LIGAS_ALVO_IDS.includes(j.league.id));

    const matches = [];

    for (const jogo of jogos) {
      const leagueId = jogo.league.id;
      const season = jogo.league.season;
      const homeId = jogo.teams.home.id;
      const awayId = jogo.teams.away.id;
      const fixtureId = jogo.fixture.id;

      // Parallel fetches
      const [homeSeason, awaySeason, homeLast5, awayLast5, pred, fixtureStats] = await Promise.all([
        getTeamSeasonStats(homeId, leagueId, season, apiKey),
        getTeamSeasonStats(awayId, leagueId, season, apiKey),
        getLast5Stats(homeId, apiKey),
        getLast5Stats(awayId, apiKey),
        apiGet("predictions", { fixture: String(fixtureId) }, apiKey),
        getFixtureStats(fixtureId, apiKey),
      ]);

      const projCorners = ((homeSeason.corners_for + awaySeason.corners_for) * 0.6) +
        ((homeLast5[0] + awayLast5[0]) * 0.4);
      const projCards = ((homeSeason.cards_avg + awaySeason.cards_avg) * 0.6) +
        ((homeLast5[1] + awayLast5[1]) * 0.4);

      const xgHome = pred[0]?.predictions?.goals?.home || 0;
      const xgAway = pred[0]?.predictions?.goals?.away || 0;

      // Extract big chances from fixture stats if available, else estimate from shots
      const bigChancesHome = Math.round((fixtureStats.shotsOnTarget[0] || 0) * 0.4);
      const bigChancesAway = Math.round((fixtureStats.shotsOnTarget[1] || 0) * 0.4);

      const match = {
        id: String(fixtureId),
        time: new Date(jogo.fixture.date).toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "America/Sao_Paulo",
        }),
        league: jogo.league.name,
        homeTeam: jogo.teams.home.name,
        awayTeam: jogo.teams.away.name,
        homeLogo: jogo.teams.home.logo,
        awayLogo: jogo.teams.away.logo,
        metrics: {
          possession: fixtureStats.possession,
          xG: [parseFloat(String(xgHome)) || 0, parseFloat(String(xgAway)) || 0],
          totalShots: fixtureStats.totalShots,
          shotsOnTarget: fixtureStats.shotsOnTarget,
          bigChances: [bigChancesHome, bigChancesAway],
          corners: [
            parseFloat(projCorners.toFixed(1)),
            parseFloat(((awaySeason.corners_for * 0.6) + (awayLast5[0] * 0.2)).toFixed(1)),
          ],
          offsides: fixtureStats.offsides,
          fouls: fixtureStats.fouls,
          yellowCards: [
            parseFloat(projCards.toFixed(1)),
            parseFloat(((awaySeason.cards_avg * 0.6) + (awayLast5[1] * 0.4)).toFixed(1)),
          ],
        },
        predictions: {
          homeWin: pred[0]?.predictions?.percent?.home || "N/A",
          draw: pred[0]?.predictions?.percent?.draw || "N/A",
          awayWin: pred[0]?.predictions?.percent?.away || "N/A",
        },
      };

      matches.push(match);
    }

    return new Response(JSON.stringify({ matches }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
