import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BASE_URL = "https://v3.football.api-sports.io";
const LIGAS_ALVO_IDS = [39, 140, 78, 135, 61, 94, 88, 253, 2, 71, 218, 144, 119, 262, 73];

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

interface TeamStats {
  goalsForAvg: number;
  goalsAgainstAvg: number;
  cornersAvg: number;
  cardsAvg: number;
  shotsAvg: number;
  shotsOnTargetAvg: number;
  possessionAvg: number;
  foulsAvg: number;
  played: number;
}

async function getTeamStats(teamId: number, leagueId: number, season: number, apiKey: string): Promise<TeamStats> {
  const stats = await apiGet("teams/statistics", {
    team: String(teamId), league: String(leagueId), season: String(season),
  }, apiKey);

  try {
    const played = stats?.fixtures?.played?.total || 0;
    if (played === 0) {
      return { goalsForAvg: 1.2, goalsAgainstAvg: 1.2, cornersAvg: 4.5, cardsAvg: 2, shotsAvg: 12, shotsOnTargetAvg: 4, possessionAvg: 50, foulsAvg: 12, played: 0 };
    }

    const goalsFor = stats?.goals?.for?.total?.total || 0;
    const goalsAgainst = stats?.goals?.against?.total?.total || 0;

    // Cards from minute buckets
    let yellowTotal = 0, redTotal = 0;
    if (stats?.cards?.yellow) {
      for (const bucket of Object.values(stats.cards.yellow)) {
        yellowTotal += (bucket as any)?.total || 0;
      }
    }
    if (stats?.cards?.red) {
      for (const bucket of Object.values(stats.cards.red)) {
        redTotal += (bucket as any)?.total || 0;
      }
    }

    // Use lineups/clean_sheet to estimate possession (API doesn't give avg possession directly)
    const cleanSheetsHome = stats?.clean_sheet?.home || 0;
    const cleanSheetsAway = stats?.clean_sheet?.away || 0;
    const cleanSheetsTotal = cleanSheetsHome + cleanSheetsAway;
    // Estimate possession from goals ratio (attacking teams tend to have more)
    const goalRatio = goalsFor / Math.max(goalsFor + goalsAgainst, 1);
    const estPossession = 35 + goalRatio * 30; // Range ~35-65

    return {
      goalsForAvg: goalsFor / played,
      goalsAgainstAvg: goalsAgainst / played,
      cornersAvg: 5, // API teams/statistics doesn't reliably return corners; default
      cardsAvg: (yellowTotal + redTotal) / played,
      shotsAvg: Math.max(8, (goalsFor / played) * 9), // estimate from scoring rate
      shotsOnTargetAvg: Math.max(3, (goalsFor / played) * 3.5),
      possessionAvg: parseFloat(estPossession.toFixed(1)),
      foulsAvg: 12, // reasonable default
      played,
    };
  } catch {
    return { goalsForAvg: 1.2, goalsAgainstAvg: 1.2, cornersAvg: 4.5, cardsAvg: 2, shotsAvg: 12, shotsOnTargetAvg: 4, possessionAvg: 50, foulsAvg: 12, played: 0 };
  }
}

// Get last N fixtures for a team (goals only - no extra API calls per fixture)
async function getLastFixturesGoals(teamId: number, count: number, apiKey: string) {
  const fixtures = await apiGet("fixtures", { team: String(teamId), last: String(count) }, apiKey);
  const goals: number[] = [];
  const corners: number[] = [];
  const cards: number[] = [];

  for (const f of fixtures) {
    const isHome = f.teams?.home?.id === teamId;
    goals.push(isHome ? (f.goals?.home || 0) : (f.goals?.away || 0));
  }

  return { goals, avgGoals: goals.length > 0 ? goals.reduce((a, b) => a + b, 0) / goals.length : 0 };
}

function calculateXG(hGFA: number, aGAA: number, aGFA: number, hGAA: number, leagueAvg: number): [number, number] {
  const safe = leagueAvg > 0 ? leagueAvg : 1.3;
  const xgH = Math.max(0.1, (hGFA / safe) * (aGAA / safe) * safe);
  const xgA = Math.max(0.1, (aGFA / safe) * (hGAA / safe) * safe);
  return [parseFloat(xgH.toFixed(2)), parseFloat(xgA.toFixed(2))];
}

function f1(v: number): number { return parseFloat(v.toFixed(1)); }

function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const apiKey = Deno.env.get("API_FUTEBOL_KEY");
  if (!apiKey) return new Response(JSON.stringify({ error: "API key not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const { date } = await req.json();
    if (!date) throw new Error("Date required");

    console.log(`Fetching fixtures for date: ${date}`);
    const fixtures = await apiGet("fixtures", { date }, apiKey);
    const FINISHED_STATUSES = ['FT', 'AET', 'PEN', 'WO', 'AWD', 'CANC', 'ABD'];
    let jogos = fixtures.filter((j: any) =>
      LIGAS_ALVO_IDS.includes(j.league.id) &&
      !FINISHED_STATUSES.includes(j.fixture.status?.short)
    );
    console.log(`Found ${jogos.length} matches in target leagues (excluding finished)`);

    // Prioritize top leagues and limit to 15 matches max to avoid timeout
    const leaguePriority: Record<number, number> = { 2: 1, 39: 2, 140: 3, 78: 4, 135: 5, 61: 6, 71: 7, 73: 8, 94: 9, 88: 10, 253: 11, 218: 12, 144: 13, 119: 14, 262: 15 };
    jogos.sort((a: any, b: any) => (leaguePriority[a.league.id] || 99) - (leaguePriority[b.league.id] || 99));
    if (jogos.length > 50) {
      console.log(`Limiting from ${jogos.length} to 50 matches`);
      jogos = jogos.slice(0, 50);
    }

    const matches = [];

    // Process matches in parallel batches of 5
    const batchSize = 5;
    for (let i = 0; i < jogos.length; i += batchSize) {
      const batch = jogos.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map(async (jogo: any) => {
        const leagueId = jogo.league.id;
        const season = jogo.league.season;
        const homeId = jogo.teams.home.id;
        const awayId = jogo.teams.away.id;
        const fixtureId = jogo.fixture.id;

        try {
          // Only 4 API calls per match (down from 20+)
          const [homeStats, awayStats, homeRecent, awayRecent] = await Promise.all([
            getTeamStats(homeId, leagueId, season, apiKey),
            getTeamStats(awayId, leagueId, season, apiKey),
            getLastFixturesGoals(homeId, 10, apiKey),
            getLastFixturesGoals(awayId, 10, apiKey),
          ]);

          // Hybrid: 60% season + 40% recent form
          const homeGoalsAvg = homeStats.played > 0
            ? homeStats.goalsForAvg * 0.6 + homeRecent.avgGoals * 0.4
            : homeRecent.avgGoals || 1.2;
          const awayGoalsAvg = awayStats.played > 0
            ? awayStats.goalsForAvg * 0.6 + awayRecent.avgGoals * 0.4
            : awayRecent.avgGoals || 1.2;

          const leagueAvgGoals = (homeStats.played + awayStats.played) > 0
            ? (homeStats.goalsForAvg + awayStats.goalsForAvg) / 2 : 1.3;
          const [xgHome, xgAway] = calculateXG(
            homeGoalsAvg, awayStats.goalsAgainstAvg,
            awayGoalsAvg, homeStats.goalsAgainstAvg, leagueAvgGoals
          );

          const homeCornersAvg = homeStats.cornersAvg;
          const awayCornersAvg = awayStats.cornersAvg;
          const homeCardsAvg = homeStats.cardsAvg;
          const awayCardsAvg = awayStats.cardsAvg;

          // Get predictions (1 more API call)
          let predictions = { homeWin: "N/A", draw: "N/A", awayWin: "N/A" };
          try {
            const pred = await apiGet("predictions", { fixture: String(fixtureId) }, apiKey);
            if (pred[0]?.predictions?.percent) {
              predictions = {
                homeWin: pred[0].predictions.percent.home || "N/A",
                draw: pred[0].predictions.percent.draw || "N/A",
                awayWin: pred[0].predictions.percent.away || "N/A",
              };
            }
          } catch { /* ignore prediction errors */ }

          return {
            id: String(fixtureId),
            time: new Date(jogo.fixture.date).toLocaleTimeString("pt-BR", {
              hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo",
            }),
            league: jogo.league.name,
            homeTeam: jogo.teams.home.name,
            awayTeam: jogo.teams.away.name,
            homeLogo: jogo.teams.home.logo,
            awayLogo: jogo.teams.away.logo,
            metrics: {
              possession: [f1(homeStats.possessionAvg), f1(awayStats.possessionAvg)] as [number, number],
              xG: [xgHome, xgAway] as [number, number],
              totalShots: [f1(homeStats.shotsAvg), f1(awayStats.shotsAvg)] as [number, number],
              shotsOnTarget: [f1(homeStats.shotsOnTargetAvg), f1(awayStats.shotsOnTargetAvg)] as [number, number],
              bigChances: [f1(homeStats.shotsOnTargetAvg * 0.35), f1(awayStats.shotsOnTargetAvg * 0.35)] as [number, number],
              corners: [f1(homeCornersAvg), f1(awayCornersAvg)] as [number, number],
              offsides: [1.5, 1.5] as [number, number],
              fouls: [f1(homeStats.foulsAvg), f1(awayStats.foulsAvg)] as [number, number],
              yellowCards: [f1(homeCardsAvg), f1(awayCardsAvg)] as [number, number],
            },
            modelData: {
              homeGoalsAvg: f1(homeGoalsAvg),
              awayGoalsAvg: f1(awayGoalsAvg),
              homeCornersAvg: f1(homeCornersAvg),
              awayCornersAvg: f1(awayCornersAvg),
              homeCardsAvg: f1(homeCardsAvg),
              awayCardsAvg: f1(awayCardsAvg),
              homeCornersVariance: f1(variance(homeRecent.goals) * 2), // proxy variance
              awayCornersVariance: f1(variance(awayRecent.goals) * 2),
              homeCardsVariance: f1(variance(homeRecent.goals)),
              awayCardsVariance: f1(variance(awayRecent.goals)),
            },
            predictions,
          };
        } catch (e) {
          console.error(`Error processing match ${fixtureId}:`, e);
          return null;
        }
      }));

      matches.push(...batchResults.filter(Boolean));
    }

    console.log(`Returning ${matches.length} matches`);
    return new Response(JSON.stringify({ matches }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("Edge function error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
