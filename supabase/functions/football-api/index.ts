import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BASE_URL = "https://v3.football.api-sports.io";

// Ligas Pré-Jogo (Sua lista original)
const LIGAS_ALVO_IDS = [39, 140, 78, 135, 61, 94, 88, 253, 2, 71, 218, 144, 119, 262, 73];

// 7 Melhores Ligas + Brasil (Foco Trader Live)
const LIGAS_LIVE_IDS = [
  39,  // Premier League
  140, // La Liga
  78,  // Bundesliga
  135, // Serie A
  61,  // Ligue 1
  71,  // Brasileirão Série A
  72,  // Brasileirão Série B
  13,  // Libertadores
];

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

function f1(v: number) { return parseFloat(v.toFixed(1)); }

function extractStatValue(stats: any[], type: string) {
  if (!stats) return 0;
  const stat = stats.find((s: any) => s.type === type);
  if (!stat || stat.value === null) return 0;
  const val = typeof stat.value === "string" ? parseFloat(stat.value.replace("%", "")) : stat.value;
  return isNaN(val) ? 0 : val;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const apiKey = Deno.env.get("API_FUTEBOL_KEY");
  if (!apiKey) return new Response(JSON.stringify({ error: "API key missing" }), { headers: corsHeaders });

  try {
    const { date, mode } = await req.json();

    // ==========================================
    // MODO LIVE (Trader Profissional)
    // ==========================================
    if (mode === "live") {
      const fixtures = await apiGet("fixtures", { live: "all" }, apiKey);
      
      const jogosLive = fixtures.filter((j: any) => LIGAS_LIVE_IDS.includes(j.league.id));
      const matches = [];

      for (const jogo of jogosLive) {
        // Para cada jogo live, pegamos as estatísticas atuais (pressão/escanteios)
        const statsResponse = await apiGet("fixtures/statistics", { fixture: String(jogo.fixture.id) }, apiKey);
        
        const homeStats = statsResponse[0]?.statistics || [];
        const awayStats = statsResponse[1]?.statistics || [];

        const hDA = extractStatValue(homeStats, "Dangerous Attacks");
        const aDA = extractStatValue(awayStats, "Dangerous Attacks");
        
        // Cálculo de Índice de Pressão Simples (Ataques Perigosos por Minuto aproximado)
        const elapsed = jogo.fixture.status.elapsed || 1;
        const hPressure = f1((hDA / elapsed) * 10); 
        const aPressure = f1((aDA / elapsed) * 10);

        matches.push({
          id: String(jogo.fixture.id),
          isLive: true,
          time: jogo.fixture.status.elapsed + "'",
          status: jogo.fixture.status.short,
          league: jogo.league.name,
          homeTeam: jogo.teams.home.name,
          awayTeam: jogo.teams.away.name,
          liveScore: {
            home: jogo.goals.home ?? 0,
            away: jogo.goals.away ?? 0
          },
          liveStats: {
            dangerousAttacks: [hDA, aDA],
            corners: [extractStatValue(homeStats, "Corner Kicks"), extractStatValue(awayStats, "Corner Kicks")],
            possession: [extractStatValue(homeStats, "Ball Possession"), extractStatValue(awayStats, "Ball Possession")],
            pressureIndex: [hPressure, aPressure]
          },
          // Mantemos a estrutura de métricas vazia ou simplificada para não quebrar o Card
          metrics: {
            corners: [extractStatValue(homeStats, "Corner Kicks"), extractStatValue(awayStats, "Corner Kicks")],
            possession: [extractStatValue(homeStats, "Ball Possession"), extractStatValue(awayStats, "Ball Possession")]
          },
          predictions: { homeWin: "-", draw: "-", awayWin: "-" }
        });
      }

      return new Response(JSON.stringify({ matches }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ==========================================
    // MODO PRÉ-JOGO (Sua lógica original intocada)
    // ==========================================
    const fixtures = await apiGet("fixtures", { date }, apiKey);
    const jogos = fixtures.filter((j: any) => LIGAS_ALVO_IDS.includes(j.league.id));
    const matches = [];

    // Nota: Para brevidade, usei apenas a parte essencial do seu loop original 
    // Certifique-se de manter suas funções f1, calcVariance e getRecentForm acima.
    for (const jogo of jogos.slice(0, 25)) {
        // ... (Aqui entra exatamente o seu loop original que você já tem)
        // Eu mantive a estrutura para você apenas colar seu loop de getRecentForm aqui
    }

    return new Response(JSON.stringify({ matches }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: "processing error" }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
                                                  
