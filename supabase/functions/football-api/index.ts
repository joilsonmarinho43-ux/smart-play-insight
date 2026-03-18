import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BASE_URL = "https://v3.football.api-sports.io";

const LIGAS_ALVO_IDS = [39, 140, 78, 135, 61, 71, 72, 73, 13, 11, 2, 848];

// ===============================
// 🔌 FETCH
// ===============================
async function fetchWithAuth(endpoint: string, apiKey: string) {
  const res = await fetch(`${BASE_URL}/${endpoint}`, {
    headers: {
      "x-apisports-key": apiKey,
    },
  });

  if (!res.ok) throw new Error("Erro na API");

  return res.json();
}

// ===============================
// 📊 MÉDIA
// ===============================
function calculateWeightedValue(results: number[]) {
  if (!results.length) return 0;
  const weights = results.map((_, i) => i + 1);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const weightedSum = results.reduce((sum, val, i) => sum + val * weights[i], 0);
  return parseFloat((weightedSum / totalWeight).toFixed(2));
}

// ===============================
// 🧠 MODELO AVANÇADO
// ===============================
function calculateAdvancedProbability(
  minute: number,
  shots: number,
  attacks: number,
  goals: number
) {
  let prob = shots * 3 + attacks * 0.4;

  if (minute >= 60) prob *= 1.2;
  if (minute >= 70) prob *= 1.3;
  if (minute >= 80) prob *= 1.4;

  if (goals === 0 && minute >= 65) prob *= 1.2;

  return Math.min(95, Math.floor(prob));
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

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const live = body?.live === true;
    const date = body?.date;

    let endpoint = "";

    if (live) {
      endpoint = "fixtures?live=all";
    } else if (date) {
      endpoint = `fixtures?date=${date}`;
    } else {
      const today = new Date().toISOString().split("T")[0];
      endpoint = `fixtures?date=${today}`;
    }

    const fixturesData = await fetchWithAuth(endpoint, apiKey);

    const allFixtures = Array.isArray(fixturesData?.response)
      ? fixturesData.response
      : [];

    const filtered = live
      ? allFixtures
      : allFixtures.filter((f: any) =>
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
        // 🔴 LIVE ELITE
        // =========================
        if (live) {
          const fixtureId = j.fixture.id;
          const minute = j.fixture.status.elapsed ?? 0;

          const homeGoals = j.goals.home ?? 0;
          const awayGoals = j.goals.away ?? 0;

          const stats = j.statistics || [];

          const getStat = (team: string, type: string) => {
            const teamStats = stats.find((s: any) => s.team.name === team);
            const stat = teamStats?.statistics?.find((st: any) => st.type === type);
            return parseInt(stat?.value) || 0;
          };

          const shotsHome = getStat(j.teams.home.name, "Shots on Goal");
          const shotsAway = getStat(j.teams.away.name, "Shots on Goal");

          const attacksHome = getStat(j.teams.home.name, "Dangerous Attacks");
          const attacksAway = getStat(j.teams.away.name, "Dangerous Attacks");

          // 🧠 PROBABILIDADE AVANÇADA
          const probHome = calculateAdvancedProbability(
            minute,
            shotsHome,
            attacksHome,
            homeGoals
          );

          const probAway = calculateAdvancedProbability(
            minute,
            shotsAway,
            attacksAway,
            awayGoals
          );

          const goalProbability = Math.min(95, probHome + probAway);

          // =========================
          // 📊 ODDS
          // =========================
          let oddsOver05 = null;
          let oddsOver15 = null;

          try {
            const oddsData = await fetchWithAuth(
              `odds?fixture=${fixtureId}`,
              apiKey
            );

            const bookmakers = oddsData?.response?.[0]?.bookmakers || [];

            const book = bookmakers[0];

            const goalsMarket = book?.bets?.find((b: any) =>
              b.name === "Goals Over/Under"
            );

            oddsOver05 = parseFloat(
              goalsMarket?.values?.find((v: any) => v.value === "Over 0.5")?.odd
            );

            oddsOver15 = parseFloat(
              goalsMarket?.values?.find((v: any) => v.value === "Over 1.5")?.odd
            );
          } catch {}

          // =========================
          // 💰 EV
          // =========================
          const calcEV = (prob: number, odd: number) => {
            if (!prob || !odd) return null;
            return parseFloat(((prob / 100 * odd - 1) * 100).toFixed(2));
          };

          const ev05 = calcEV(goalProbability, oddsOver05);
          const ev15 = calcEV(goalProbability - 20, oddsOver15);

          // =========================
          // 🎯 ENTRADAS
          // =========================
          let entry = null;

          if (ev05 && ev05 > 12 && minute >= 65) {
            entry = "🔥 BACK Over 0.5 (ELITE)";
          }

          if (ev15 && ev15 > 15 && minute >= 70) {
            entry = "💣 BACK Over 1.5 (ALTO VALOR)";
          }

          if (ev05 && ev05 < -10) {
            entry = "❌ LAY Over 0.5";
          }

          // =========================
          // 🧠 PADRÃO EUROPEU
          // =========================
          let pattern = null;

          if (shotsHome + shotsAway >= 10 && minute < 30) {
            pattern = "🔥 Jogo acelerado desde o início";
          }

          if (minute >= 75 && homeGoals === awayGoals) {
            pattern = "💣 Tendência forte de gol tardio";
          }

          // =========================
          // 🚨 ALERTA
          // =========================
          let alert = null;

          if (ev05 && ev05 > 15) {
            alert = "💰 VALOR MUITO ALTO DETECTADO";
          }

          if (goalProbability >= 90) {
            alert = "⚽ GOL IMINENTE";
          }

          return {
            id: String(j.fixture.id),
            minute,
            league: j.league.name,
            homeTeam: j.teams.home.name,
            awayTeam: j.teams.away.name,
            status: (j.fixture.status.short || '').toUpperCase(),

            goalsHome: homeGoals,
            goalsAway: awayGoals,

            // IA
            goalProbability,
            probHome,
            probAway,

            // ODDS
            oddsOver05,
            oddsOver15,

            // EV
            ev05,
            ev15,

            // TRADER
            entry,
            pattern,
            alert,
          };
        }

        // =========================
        // 📊 PRÉ-JOGO (INALTERADO)
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
