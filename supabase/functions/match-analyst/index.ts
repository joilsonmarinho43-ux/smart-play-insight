// ════════════════════════════════════════════════════════════════
// match-analyst
// Camada de interpretação humana (Analista de Performance Esportiva
// + Especialista em Valor de Mercado) por cima da leitura técnica
// já gerada pelo readingEngine. Usa Lovable AI Gateway.
// Saída estruturada: { cenario, pontoAtencao, veredito, risco }
// ════════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min

function sb() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const sk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, sk);
}

async function cacheGet(key: string) {
  try {
    const { data } = await sb()
      .from("cache_api")
      .select("dados_json, ultima_atualizacao")
      .eq("cache_key", key)
      .maybeSingle();
    if (!data) return null;
    const age = Date.now() - new Date(data.ultima_atualizacao).getTime();
    if (age > CACHE_TTL_MS) return null;
    return data.dados_json;
  } catch {
    return null;
  }
}

async function cacheSet(key: string, value: any) {
  try {
    await sb().from("cache_api").upsert({
      cache_key: key,
      dados_json: value,
      status_jogo: "PRE",
      ultima_atualizacao: new Date().toISOString(),
    });
  } catch (e) {
    console.error("cacheSet", e);
  }
}

const SYSTEM_PROMPT = `Você é um Analista de Performance Esportiva e Especialista em Valor de Mercado (Value Betting).

Sua função é cruzar dados estatísticos puros com o contexto real do confronto e entregar uma leitura crítica de pré-jogo.

# FLUXO DE RACIOCÍNIO (obrigatório, nesta ordem)
1. FILTRO DE CONFIABILIDADE
   - Avalie a média de gols recente. Se for alta mas houver desfalques ofensivos relevantes, reduza a confiança em mercados de gols.
   - Avalie a motivação: mata-mata, clássico, disputa de título ou rebaixamento. Se houver, priorize cautela e considere Under.

2. CONFRONTO DE DADOS ("o dedo na ferida")
   - Compare a expectativa estatística com o momento defensivo e ofensivo recente.
   - Se os números apontam tendência mas o histórico das últimas 3 a 5 partidas mostra queda de rendimento, aponte a divergência explicitamente.

3. SÍNTESE
   - Não repita números brutos — o usuário já os vê na tela. Foque no "porquê".
   - Linguagem direta, profissional, em português do Brasil. Sem emojis. Sem palavras "IA", "algoritmo", "robô", "Poisson", "regressão", "modelo".

# REGRAS DE OURO
- Se a estatística estiver muito óbvia ("batida"), avise que o mercado provavelmente já precificou e o risco/retorno piorou.
- Nunca garanta resultado. Use "alta probabilidade", "tendência favorável", "cenário de risco".
- Se houver dados conflitantes (estatística aponta um lado, contexto aponta outro), alerte o usuário sobre a inconsistência.

# SAÍDA
Devolva APENAS um JSON válido, sem markdown, sem comentários, no formato:
{
  "cenario": "1 a 3 frases. Resumo do contexto: motivação e momento dos dois times.",
  "pontoAtencao": "1 a 3 frases. O fator que pode quebrar a estatística (desfalques, estilo de jogo, calendário, divergência mercado x números).",
  "veredito": "1 a 3 frases. Recomendação baseada em risco x retorno. Pode sugerir um mercado específico, evitar um lado, ou indicar que não há valor claro.",
  "risco": "baixo" | "medio" | "alto"
}`;

function buildUserPayload(input: any): string {
  const m = input.match || {};
  const r = input.reading || {};
  const c = input.context || {};
  const odds = c.odds || {};

  return JSON.stringify(
    {
      partida: {
        casa: m.homeTeam,
        fora: m.awayTeam,
        liga: m.league,
        horario: m.time,
      },
      projecao: {
        gols_projetados: r.projectedGoals,
        placares_provaveis: r.likelyScores,
        previsibilidade: r.predictability,
        qualidade_contexto: r.contextQuality,
      },
      resumo_tecnico: r.summary,
      leitura_tatica: r.tactical,
      melhores_mercados: (r.opportunities || []).slice(0, 4).map((o: any) => ({
        mercado: o.market,
        confianca_pct: o.confidence,
      })),
      linhas_gols: (r.goalLines || []).map((g: any) => ({
        linha: `${g.side} ${g.line}`,
        prob_pct: g.probability,
        recomendado: g.recommended,
      })),
      alertas_internos: r.alerts,
      contexto: {
        confiabilidade: c.reliability,
        escalacoes: c.lineups,
        lesoes: c.injuries
          ? {
              casa: {
                impacto: c.injuries.home?.impact,
                quantidade: c.injuries.home?.count,
              },
              fora: {
                impacto: c.injuries.away?.impact,
                quantidade: c.injuries.away?.count,
              },
            }
          : null,
        motivacao: c.motivation,
        desgaste: c.fatigue,
      },
      mercado: {
        odds_1x2: { casa: odds.home, empate: odds.draw, fora: odds.away },
        over_under_25: { over: odds.over25, under: odds.under25 },
        btts: { sim: odds.bttsYes, nao: odds.bttsNo },
        abertura: odds.opening,
        movimento: odds.movement,
      },
    },
    null,
    0,
  );
}

function safeParseAnalyst(raw: string): any | null {
  if (!raw) return null;
  let txt = raw.trim();
  // remove cercas markdown se vierem
  txt = txt.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = txt.indexOf("{");
  const end = txt.lastIndexOf("}");
  if (start < 0 || end < 0) return null;
  try {
    const obj = JSON.parse(txt.slice(start, end + 1));
    if (!obj || typeof obj !== "object") return null;
    const cenario = String(obj.cenario || "").trim();
    const pontoAtencao = String(obj.pontoAtencao || obj.ponto_atencao || "").trim();
    const veredito = String(obj.veredito || "").trim();
    const risco = ["baixo", "medio", "alto"].includes(obj.risco) ? obj.risco : "medio";
    if (!cenario || !pontoAtencao || !veredito) return null;
    return { cenario, pontoAtencao, veredito, risco };
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const fixtureId = body?.match?.id || body?.fixtureId;
    const cacheKey = fixtureId ? `analyst:${fixtureId}` : null;

    if (cacheKey) {
      const cached = await cacheGet(cacheKey);
      if (cached) {
        return new Response(JSON.stringify({ ...cached, cached: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY ausente" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const userPayload = buildUserPayload(body);

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content:
              "Analise a partida abaixo seguindo o fluxo. Devolva apenas o JSON.\n\n" +
              userPayload,
          },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (resp.status === 429) {
      return new Response(JSON.stringify({ error: "rate_limited" }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (resp.status === 402) {
      return new Response(JSON.stringify({ error: "credits_exhausted" }), {
        status: 402,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!resp.ok) {
      const txt = await resp.text();
      console.error("AI gateway error", resp.status, txt);
      return new Response(
        JSON.stringify({ error: "ai_error", status: resp.status }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content || "";
    const parsed = safeParseAnalyst(content);
    if (!parsed) {
      console.warn("analyst parse fail", content?.slice(0, 300));
      return new Response(
        JSON.stringify({ error: "parse_fail" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (cacheKey) await cacheSet(cacheKey, parsed);

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("match-analyst fatal", e);
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
