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

/* 🔥 NOVA FUNÇÃO: média ponderada (jogos recentes valem mais) */
function weightedAverage(values: number[]): number {
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

      const teamStats = isHome ? fixtureStats[0]?.statistics : fixtureStats[1]?.statistics;

      if (teamStats) {
        corners.push(extractStatValue(teamStats, 'Corner Kicks'));
        shots.push(extractStatValue(teamStats, 'Total Shots'));
        shotsOnTarget.push(extractStatValue(teamStats, 'Shots on Goal'));
        possession.push(extractStatValue(teamStats, 'Ball Possession'));
        fouls.push(extractStatValue(teamStats, 'Fouls'));
        offsides.push(extractStatValue(teamStats, 'Offsides'));

        const yellowCards = extractStatValue(teamStats, 'Yellow Cards');
        const redCards = extractStatValue(teamStats, 'Red Cards');
        cards.push(yellowCards + redCards);

        const bigChancesVal = extractStatValue(teamStats, 'Big chances');
        bigChances.push(bigChancesVal > 0 ? bigChancesVal : Math.max(0, Math.round(extractStatValue(teamStats, 'Shots on Goal') * 0.3)));
      }
    }
  }

  /* 🔥 USANDO MÉDIA PONDERADA EM VEZ DE MÉDIA SIMPLES */
  const avg = (arr: number[]) => weightedAverage(arr);

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
