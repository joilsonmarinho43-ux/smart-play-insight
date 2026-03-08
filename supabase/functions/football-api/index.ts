import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

function f1(v: number): number { return parseFloat(v.toFixed(1)); }
function f2(v: number): number { return parseFloat(v.toFixed(2)); }

function calcVariance(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
}

function extractStatValue(stats: any[], type: string): number {
  if (!stats || !Array.isArray(stats)) return 0;
  const stat = stats.find((s: any) => s.type === type);
  if (!stat || stat.value === null || stat.value === undefined) return 0;
  const val = typeof stat.value === 'string' ? parseFloat(stat.value.replace('%', '')) : stat.value;
  return isNaN(val) ? 0 : val;
}

interface RecentFormData {
  goals: number[];
  corners: number[];
  cards: number[];
  shots: number[];
  shotsOnTarget: number[];
  possession: number[];
  fouls: number[];
  offsides: number[];
  bigChances: number[];
  avgGoals: number;
  avgCorners: number;
  avgCards: number;
  avgShots: number;
  avgShotsOnTarget: number;
  avgPossession: number;
  avgFouls: number;
  avgOffsides: number;
  avgBigChances: number;
  gamesTotal: number;
  gamesWithStats: number;
}

// Fetch last N fixtures for a team, then fetch real statistics for each
async function getRecentForm(teamId: number, count: number, apiKey: string): Promise<RecentFormData> {
  const fixtures = await apiGet("fixtures", { team: String(teamId), last: String(count), status: "FT" }, apiKey);

  const goals: number[] = [];
  const corners: number[] = [];
  const cards: number[] = [];
  const shots: number[] = [];
  const shotsOnTarget: number[] = [];
  const possession: number[] = [];
  const fouls: number[] = [];
  const offsides: number[] = [];
  const bigChances: number[] = [];

  // Fetch statistics for each fixture in parallel (batches of 3 to respect rate limits)
  const fixtureIds = fixtures.map((f: any) => f.fixture.id);
  const statsMap: Record<number, any[]> = {};
  
  for (let i = 0; i < fixtureIds.length; i += 3) {
    const batch = fixtureIds.slice(i, i + 3);
    const results = await Promise.all(
      batch.map((fId: number) => apiGet("fixtures/statistics", { fixture: String(fId) }, apiKey))
    );
    batch.forEach((fId: number, idx: number) => {
      statsMap[fId] = results[idx];
    });
  }

  for (const f of fixtures) {
    const isHome = f.teams?.home?.id === teamId;
    goals.push(isHome ? (f.goals?.home || 0) : (f.goals?.away || 0));

    const fixtureStats = statsMap[f.fixture.id];
    if (fixtureStats && Array.isArray(fixtureStats) && fixtureStats.length >= 2) {
      // Find the team's stats (home team is index 0, away is index 1)
      const teamStats = isHome ? fixtureStats[0]?.statistics : fixtureStats[1]?.statistics;

      if (teamStats) {
        corners.push(extractStatValue(teamStats, 'Corner Kicks'));
        shots.push(extractStatValue(teamStats, 'Total Shots'));
        shotsOnTarget.push(extractStatValue(teamStats, 'Shots on Goal'));
        possession.push(extractStatValue(teamStats, 'Ball Possession'));
        fouls.push(extractStatValue(teamStats, 'Fouls'));
        offsides.push(extractStatValue(teamStats, 'Offsides'));

        // Yellow + Red cards from stats
        const yellowCards = extractStatValue(teamStats, 'Yellow Cards');
        const redCards = extractStatValue(teamStats, 'Red Cards');
        cards.push(yellowCards + redCards);

        // Expected goals from API if available, else estimate big chances
        const expectedGoals = extractStatValue(teamStats, 'expected_goals');
        const bigChancesVal = extractStatValue(teamStats, 'Big chances');
        bigChances.push(bigChancesVal > 0 ? bigChancesVal : Math.max(0, Math.round(extractStatValue(teamStats, 'Shots on Goal') * 0.3)));
      }
    }
  }

  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  return {
    goals, corners, cards, shots, shotsOnTarget, possession, fouls, offsides, bigChances,
    avgGoals: avg(goals),
    avgCorners: avg(corners),
    avgCards: avg(cards),
    avgShots: avg(shots),
    avgShotsOnTarget: avg(shotsOnTarget),
    avgPossession: avg(possession),
    avgFouls: avg(fouls),
    avgOffsides: avg(offsides),
    avgBigChances: avg(bigChances),
    gamesTotal: fixtures.length,
    gamesWithStats: corners.length,
  };
}

interface TeamSeasonStats {
  goalsForAvg: number;
  goalsAgainstAvg: number;
  cardsAvg: number;
  played: number;
}

async function getTeamSeasonStats(teamId: number, leagueId: number, season: number, apiKey: string): Promise<TeamSeasonStats> {
  const stats = await apiGet("teams/statistics", {
    team: String(teamId), league: String(leagueId), season: String(season),
  }, apiKey);

  try {
    const played = stats?.fixtures?.played?.total || 0;
    if (played === 0) {
      return { goalsForAvg: 1.2, goalsAgainstAvg: 1.2, cardsAvg: 2, played: 0 };
    }

    const goalsFor = stats?.goals?.for?.total?.total || 0;
    const goalsAgainst = stats?.goals?.against?.total?.total || 0;

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

    return {
      goalsForAvg: goalsFor / played,
      goalsAgainstAvg: goalsAgainst / played,
      cardsAvg: (yellowTotal + redTotal) / played,
      played,
    };
  } catch {
    return { goalsForAvg: 1.2, goalsAgainstAvg: 1.2, cardsAvg: 2, played: 0 };
  }
}

function calculateXG(hGFA: number, aGAA: number, aGFA: number, hGAA: number, leagueAvg: number): [number, number] {
  const safe = leagueAvg > 0 ? leagueAvg : 1.3;
  const xgH = Math.max(0.1, (hGFA / safe) * (aGAA / safe) * safe);
  const xgA = Math.max(0.1, (aGFA / safe) * (hGAA / safe) * safe);
  return [f2(xgH), f2(xgA)];
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

    const leaguePriority: Record<number, number> = { 2: 1, 39: 2, 140: 3, 78: 4, 135: 5, 61: 6, 71: 7, 73: 8, 94: 9, 88: 10, 253: 11, 218: 12, 144: 13, 119: 14, 262: 15 };
    jogos.sort((a: any, b: any) => (leaguePriority[a.league.id] || 99) - (leaguePriority[b.league.id] || 99));
    if (jogos.length > 30) {
      console.log(`Limiting from ${jogos.length} to 30 matches`);
      jogos = jogos.slice(0, 30);
    }

    const matches = [];
    const RECENT_COUNT = 10; // Last 10 matches for real stats

    // Process matches in parallel batches of 3 (more API calls per match now)
    const batchSize = 3;
    for (let i = 0; i < jogos.length; i += batchSize) {
      const batch = jogos.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map(async (jogo: any) => {
        const leagueId = jogo.league.id;
        const season = jogo.league.season;
        const homeId = jogo.teams.home.id;
        const awayId = jogo.teams.away.id;
        const fixtureId = jogo.fixture.id;

        try {
          // Fetch season stats + recent form with REAL fixture statistics
          const [homeSeason, awaySeason, homeForm, awayForm] = await Promise.all([
            getTeamSeasonStats(homeId, leagueId, season, apiKey),
            getTeamSeasonStats(awayId, leagueId, season, apiKey),
            getRecentForm(homeId, RECENT_COUNT, apiKey),
            getRecentForm(awayId, RECENT_COUNT, apiKey),
          ]);

          // Hybrid goals: 60% season + 40% recent form
          const homeGoalsAvg = homeSeason.played > 0
            ? homeSeason.goalsForAvg * 0.6 + homeForm.avgGoals * 0.4
            : homeForm.avgGoals || 1.2;
          const awayGoalsAvg = awaySeason.played > 0
            ? awaySeason.goalsForAvg * 0.6 + awayForm.avgGoals * 0.4
            : awayForm.avgGoals || 1.2;

          // Hybrid cards: 60% season + 40% recent
          const homeCardsAvg = homeSeason.played > 0
            ? homeSeason.cardsAvg * 0.6 + homeForm.avgCards * 0.4
            : homeForm.avgCards || 2;
          const awayCardsAvg = awaySeason.played > 0
            ? awaySeason.cardsAvg * 0.6 + awayForm.avgCards * 0.4
            : awayForm.avgCards || 2;

          // Corners, shots, possession, fouls, offsides: 100% from real recent data
          const homeCornersAvg = homeForm.avgCorners || 4.5;
          const awayCornersAvg = awayForm.avgCorners || 4.5;

          const leagueAvgGoals = (homeSeason.played + awaySeason.played) > 0
            ? (homeSeason.goalsForAvg + awaySeason.goalsForAvg) / 2 : 1.3;
          const [xgHome, xgAway] = calculateXG(
            homeGoalsAvg, awaySeason.goalsAgainstAvg,
            awayGoalsAvg, homeSeason.goalsAgainstAvg, leagueAvgGoals
          );

          // Predictions from API
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
              possession: [f1(homeForm.avgPossession || 50), f1(awayForm.avgPossession || 50)] as [number, number],
              xG: [xgHome, xgAway] as [number, number],
              totalShots: [f1(homeForm.avgShots || 10), f1(awayForm.avgShots || 10)] as [number, number],
              shotsOnTarget: [f1(homeForm.avgShotsOnTarget || 4), f1(awayForm.avgShotsOnTarget || 4)] as [number, number],
              bigChances: [f1(homeForm.avgBigChances || 1), f1(awayForm.avgBigChances || 1)] as [number, number],
              corners: [f1(homeCornersAvg), f1(awayCornersAvg)] as [number, number],
              offsides: [f1(homeForm.avgOffsides || 1.5), f1(awayForm.avgOffsides || 1.5)] as [number, number],
              fouls: [f1(homeForm.avgFouls || 12), f1(awayForm.avgFouls || 12)] as [number, number],
              yellowCards: [f1(homeCardsAvg), f1(awayCardsAvg)] as [number, number],
            },
            modelData: {
              homeGoalsAvg: f1(homeGoalsAvg),
              awayGoalsAvg: f1(awayGoalsAvg),
              homeCornersAvg: f1(homeCornersAvg),
              awayCornersAvg: f1(awayCornersAvg),
              homeCardsAvg: f1(homeCardsAvg),
              awayCardsAvg: f1(awayCardsAvg),
              // REAL variance from actual fixture data
              homeCornersVariance: f1(calcVariance(homeForm.corners)),
              awayCornersVariance: f1(calcVariance(awayForm.corners)),
              homeCardsVariance: f1(calcVariance(homeForm.cards)),
              awayCardsVariance: f1(calcVariance(awayForm.cards)),
            },
            sampleSize: {
              homeGames: homeForm.gamesTotal,
              awayGames: awayForm.gamesTotal,
              homeWithStats: homeForm.gamesWithStats,
              awayWithStats: awayForm.gamesWithStats,
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
