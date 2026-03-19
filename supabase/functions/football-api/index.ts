import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BASE_URL = "https://v3.football.api-sports.io";

// Abre o banco de dados de cache do Deno
const kv = await Deno.openKv();

async function fetchWithAuth(endpoint: string, apiKey: string) {
  const res = await fetch(`${BASE_URL}/${endpoint}`, {
    headers: { "x-apisports-key": apiKey },
  });
  if (!res.ok) throw new Error("Erro API");
  return res.json();
}

function avg(arr: number[]) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ... (Funções Poisson e Factorial permanecem iguais)

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("API_FUTEBOL_KEY");
    const body = await req.json().catch(() => ({}));
    const date = body?.date || new Date().toISOString().split("T")[0];
    const isLive = body?.live || false;

    // --- LÓGICA DE CACHE NO SERVIDOR ---
    const cacheKey = isLive ? ["matches", "live"] : ["matches", date];
    const cached = await kv.get(cacheKey);

    // Se tiver cache de menos de 15 min (Live) ou 1 hora (Pré), retorna ele
    if (cached.value) {
      console.log("✅ Servindo dados do Cache Deno KV - Economia de 100% de créditos");
      return new Response(JSON.stringify(cached.value), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Se não tem cache, busca na API (Apenas 1 vez por hora)
    const endpoint = isLive ? "fixtures?live=all" : `fixtures?date=${date}`;
    const fixturesData = await fetchWithAuth(endpoint, apiKey);
    const fixtures = (fixturesData?.response || []).slice(0, 40); // Limitamos a 40 jogos para não estourar tempo de execução

    const matches = await Promise.all(
      fixtures.map(async (j: any) => {
        // Aqui o histórico também poderia ter cache, mas o cache da lista acima já resolve 99%
        const [homeGames, awayGames] = await Promise.all([
          fetchWithAuth(`fixtures?team=${j.teams.home.id}&last=5&status=FT`, apiKey),
          fetchWithAuth(`fixtures?team=${j.teams.away.id}&last=5&status=FT`, apiKey),
        ]);

        // ... (Toda a sua lógica de processamento de homeGoals/awayGoals permanece igual)
        
        // Retorno do objeto do jogo (conforme seu código original)
        return {
          id: String(j.fixture.id),
          // ... (restante dos campos iguais)
        };
      })
    );

    const responseData = { matches };

    // SALVA NO CACHE POR 1 HORA (ou 2 min se for Live)
    const expireTime = isLive ? 120000 : 3600000; 
    await kv.set(cacheKey, responseData, { expireIn: expireTime });

    return new Response(JSON.stringify(responseData), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ matches: [] }), { headers: corsHeaders });
  }
});
