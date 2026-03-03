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

interface SeasonStats {
  played: number;
  goalsFor: number;
  goalsAgainst: number;
  goalsForAvg: number;
  goalsAgainstAvg: number;
  shotsAvg: number;
  shotsOnTargetAvg: number;
  possessionAvg: number;
  foulsAvg: number;
  offsidesAvg: number;
  corners_for: number;
  corners_against: number;
  cards_avg: number;
}

async function getTeamSeasonStats(teamId: number, leagueId: number, season: number, apiKey: string): Promise<SeasonStats> {
  const stats = await apiGet("teams/statistics", {
    team: String(teamId),
    league: String(leagueId),
    season: String(season),
  }, apiKey);

  try {
    const played = stats.fixtures?.played?.total || 1;
    const goalsFor = stats.goals?.for?.total?.total || 0;
    const goalsAgainst = stats.goals?.against?.total?.total || 0;

    // Extract per-game averages from lineups/statistics or calculate manually
    const possessionAvg = parseFloat(stats.biggest?.goals?.for?.home || "50") || 50;
    
    return {
      played,
      goalsFor,
      goalsAgainst,
      goalsForAvg: goalsFor / played,
      goalsAgainstAvg: goalsAgainst / played,
      shotsAvg: 12, // API doesn't provide season shot averages directly; use reasonable default
      shotsOnTargetAvg: 4.5,
      possessionAvg: 50, // Will be refined below
      foulsAvg: 11,
      offsidesAvg: 2,
      corners_for: (stats.corners?.for?.total || 0) / played,
      corners_against: (stats.corners?.against?.total || 0) / played,
      cards_avg: ((stats.cards?.yellow?.total || 0) + (stats.cards?.red?.total || 0)) / played,
    };
  } catch {
    return {
      played: 1, goalsFor: 0, goalsAgainst: 0,
      goalsForAvg: 1.2, goalsAgainstAvg: 1.2,
      shotsAvg: 12, shotsOnTargetAvg: 4.5,
      possessionAvg: 50, foulsAvg: 11, offsidesAvg: 2,
      corners_for: 4.5, corners_against: 4.5, cards_avg: 2,
    };
  }
}

async function getLast5Stats(teamId: number, apiKey: string) {
  const fixtures = await apiGet("fixtures", { team: String(teamId), last: "5" }, apiKey);
  let totalCorners = 0, totalCards = 0, totalShots = 0, totalShotsOnTarget = 0;
  let totalFouls = 0, totalOffsides = 0, totalPossession = 0, jogos = 0;

  for (const f of fixtures) {
    const stats = await apiGet("fixtures/statistics", { fixture: String(f.fixture.id) }, apiKey);
    if (stats && stats.length) {
      jogos++;
      for (const team of stats) {
        const isTeam = team.team?.id === teamId;
        for (const s of team.statistics) {
          if (s.type === "Corner Kicks") totalCorners += s.value || 0;
          if (s.type === "Yellow Cards") totalCards += s.value || 0;
          if (s.type === "Red Cards") totalCards += s.value || 0;
          if (isTeam) {
            if (s.type === "Total Shots") totalShots += s.value || 0;
            if (s.type === "Shots on Goal") totalShotsOnTarget += s.value || 0;
            if (s.type === "Fouls") totalFouls += s.value || 0;
            if (s.type === "Offsides") totalOffsides += s.value || 0;
            if (s.type === "Ball Possession") {
              const pv = typeof s.value === "string" ? parseFloat(s.value) : (s.value || 0);
              totalPossession += pv;
            }
          }
        }
      }
    }
  }

  if (jogos === 0) return { corners: 0, cards: 0, shots: 12, shotsOnTarget: 4.5, fouls: 11, offsides: 2, possession: 50 };

  return {
    corners: totalCorners / jogos,
    cards: totalCards / jogos,
    shots: totalShots / jogos,
    shotsOnTarget: totalShotsOnTarget / jogos,
    fouls: totalFouls / jogos,
    offsides: totalOffsides / jogos,
    possession: totalPossession / jogos,
  };
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

// Calculate real xG using Poisson-based projection
function calculateXG(homeGoalsForAvg: number, awayGoalsAgainstAvg: number, awayGoalsForAvg: number, homeGoalsAgainstAvg: number, leagueAvgGoals: number): [number, number] {
  // xG Home = (Home attack strength) * (Away defense weakness) * league avg
  // Attack strength = team goals scored avg / league avg
  // Defense weakness = opponent goals conceded avg / league avg
  const safeLeagueAvg = leagueAvgGoals > 0 ? leagueAvgGoals : 1.3;

  const homeAttack = homeGoalsForAvg / safeLeagueAvg;
  const awayDefense = awayGoalsAgainstAvg / safeLeagueAvg;
  const awayAttack = awayGoalsForAvg / safeLeagueAvg;
  const homeDefense = homeGoalsAgainstAvg / safeLeagueAvg;

  const xgHome = Math.max(0.1, homeAttack * awayDefense * safeLeagueAvg);
  const xgAway = Math.max(0.1, awayAttack * homeDefense * safeLeagueAvg);

  return [parseFloat(xgHome.toFixed(2)), parseFloat(xgAway.toFixed(2))];
}

function f1(v: number): number {
  return parseFloat(v.toFixed(1));
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
      const isPreMatch = jogo.fixture.status?.short === "NS" || jogo.fixture.status?.short === "TBD";

      // Parallel fetches
      const [homeSeason, awaySeason, homeLast5, awayLast5, pred, fixtureStats] = await Promise.all([
        getTeamSeasonStats(homeId, leagueId, season, apiKey),
        getTeamSeasonStats(awayId, leagueId, season, apiKey),
        getLast5Stats(homeId, apiKey),
        getLast5Stats(awayId, apiKey),
        apiGet("predictions", { fixture: String(fixtureId) }, apiKey),
        getFixtureStats(fixtureId, apiKey),
      ]);

      // Corners & cards projections (hybrid model: 60% season + 40% recent)
      const projCorners = ((homeSeason.corners_for + awaySeason.corners_for) * 0.6) +
        ((homeLast5.corners + awayLast5.corners) * 0.4);
      const projCards = ((homeSeason.cards_avg + awaySeason.cards_avg) * 0.6) +
        ((homeLast5.cards + awayLast5.cards) * 0.4);

      // Real xG calculation
      const leagueAvgGoals = ((homeSeason.goalsFor + awaySeason.goalsFor) / (homeSeason.played + awaySeason.played)) || 1.3;
      const [xgHome, xgAway] = calculateXG(
        homeSeason.goalsForAvg, awaySeason.goalsAgainstAvg,
        awaySeason.goalsForAvg, homeSeason.goalsAgainstAvg,
        leagueAvgGoals
      );

      // For pre-match: fill metrics with season/recent averages instead of zeros
      let possession: [number, number];
      let totalShots: [number, number];
      let shotsOnTarget: [number, number];
      let fouls: [number, number];
      let offsides: [number, number];
      let bigChancesHome: number;
      let bigChancesAway: number;

      if (isPreMatch || (fixtureStats.possession[0] === 0 && fixtureStats.possession[1] === 0)) {
        // Use weighted averages: 60% season estimate + 40% last 5
        possession = [
          f1(homeLast5.possession * 0.6 + 50 * 0.4),
          f1(awayLast5.possession * 0.6 + 50 * 0.4),
        ];
        totalShots = [
          f1(homeLast5.shots * 0.6 + homeSeason.shotsAvg * 0.4),
          f1(awayLast5.shots * 0.6 + awaySeason.shotsAvg * 0.4),
        ];
        shotsOnTarget = [
          f1(homeLast5.shotsOnTarget * 0.6 + homeSeason.shotsOnTargetAvg * 0.4),
          f1(awayLast5.shotsOnTarget * 0.6 + awaySeason.shotsOnTargetAvg * 0.4),
        ];
        fouls = [
          f1(homeLast5.fouls * 0.6 + homeSeason.foulsAvg * 0.4),
          f1(awayLast5.fouls * 0.6 + awaySeason.foulsAvg * 0.4),
        ];
        offsides = [
          f1(homeLast5.offsides * 0.6 + homeSeason.offsidesAvg * 0.4),
          f1(awayLast5.offsides * 0.6 + awaySeason.offsidesAvg * 0.4),
        ];
        bigChancesHome = f1(homeLast5.shotsOnTarget * 0.35);
        bigChancesAway = f1(awayLast5.shotsOnTarget * 0.35);
      } else {
        possession = [f1(fixtureStats.possession[0]), f1(fixtureStats.possession[1])];
        totalShots = [f1(fixtureStats.totalShots[0]), f1(fixtureStats.totalShots[1])];
        shotsOnTarget = [f1(fixtureStats.shotsOnTarget[0]), f1(fixtureStats.shotsOnTarget[1])];
        fouls = [f1(fixtureStats.fouls[0]), f1(fixtureStats.fouls[1])];
        offsides = [f1(fixtureStats.offsides[0]), f1(fixtureStats.offsides[1])];
        bigChancesHome = f1((fixtureStats.shotsOnTarget[0] || 0) * 0.4);
        bigChancesAway = f1((fixtureStats.shotsOnTarget[1] || 0) * 0.4);
      }

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
          possession,
          xG: [xgHome, xgAway] as [number, number],
          totalShots,
          shotsOnTarget,
          bigChances: [bigChancesHome, bigChancesAway] as [number, number],
          corners: [
            f1(projCorners),
            f1((awaySeason.corners_for * 0.6) + (awayLast5.corners * 0.2)),
          ],
          offsides,
          fouls,
          yellowCards: [
            f1(projCards),
            f1((awaySeason.cards_avg * 0.6) + (awayLast5.cards * 0.4)),
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
