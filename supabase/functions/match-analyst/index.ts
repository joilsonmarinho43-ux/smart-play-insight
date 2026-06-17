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
const PROMPT_VERSION = "v6"; // bump: análise detalhada por mercado (1x2, dupla chance, handicap, gols, btts, escanteios, cartões), desfalques, árbitro e odds de referência

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

const DETAIL_SCHEMA_BLOCK = `# SAÍDA — JSON ÚNICO (sem markdown, sem comentários)
Você é OBRIGADO a preencher TODOS os campos abaixo. Se não tiver dado para um item, escreva uma frase curta com a leitura possível ("sem desfalques relevantes conhecidos", "árbitro não confirmado, cenário neutro", etc.). NUNCA omita campos.

Formato exato:
{
  "cenario": "2 a 4 frases. Contexto, momento dos dois times, favorito segundo o mercado e por quê.",
  "pontoAtencao": "2 a 4 frases. Fatores que podem quebrar a estatística (desfalques, viagem, mata-mata, clássico, calendário, divergência modelo×mercado).",
  "veredito": "2 a 4 frases. Recomendação principal com mercado específico, justificativa de valor (odd × probabilidade) e qual entrada evitar.",
  "risco": "baixo" | "medio" | "alto",
  "contextoDetalhado": {
    "desfalques": "Lesões, suspensões e dúvidas dos dois lados (cite nomes quando souber) e o impacto tático.",
    "arbitro": "Árbitro escalado (se souber) e tendência (rigoroso/permissivo, média de cartões). Caso desconhecido, 'árbitro não confirmado'.",
    "clima": "Condição esperada e impacto (chuva, calor, altitude, gramado). Se não souber, 'sem informação climática relevante'.",
    "motivacao": "Importância da partida para cada lado (título, classificação, rebaixamento, amistoso) e como muda a postura."
  },
  "mercados": {
    "vitoria": "Análise do 1X2: quem tem mais chance e por quê. Cite a odd quando recebida.",
    "duplaChance": "Recomendação de dupla chance (1X, 12 ou X2) com justificativa.",
    "handicap": "Sugestão de handicap asiático coerente com o favorito (NUNCA + para favorito, NUNCA − para azarão).",
    "overUnderGols": "Leitura de Over/Under 1.5, 2.5 e 3.5. Indique a linha com melhor valor.",
    "btts": "Ambas marcam Sim ou Não, com motivo.",
    "escanteios": "Tendência de escanteios (Over/Under 8.5/9.5/10.5) por postura ofensiva, posse e pressão esperada.",
    "cartoes": "Tendência de cartões (Over/Under 3.5/4.5) considerando rivalidade, árbitro e estilo.",
    "placarExato": "1 a 3 placares mais prováveis, separados por vírgula (ex: '1-1, 2-1, 0-1')."
  },
  "oddsReferencia": {
    "casa": "Odd justa estimada para vitória da casa (ex: '2.10') ou '—'.",
    "empate": "Odd justa estimada para empate.",
    "fora": "Odd justa estimada para vitória visitante.",
    "over25": "Odd justa estimada para Over 2.5.",
    "under25": "Odd justa estimada para Under 2.5.",
    "bttsSim": "Odd justa estimada para ambas marcam Sim.",
    "escanteiosOver9": "Odd justa estimada para Over 9.5 escanteios.",
    "cartoesOver4": "Odd justa estimada para Over 4.5 cartões."
  }
}`;

const SYSTEM_PROMPT = `Você é um Analista de Performance Esportiva e Especialista em Valor de Mercado (Value Betting).

Sua função é cruzar dados estatísticos com o contexto real do confronto e entregar uma leitura crítica de pré-jogo COBRINDO TODOS OS PRINCIPAIS MERCADOS (1X2, dupla chance, handicap, over/under gols, BTTS, escanteios, cartões, placar exato).

# FLUXO DE RACIOCÍNIO (obrigatório, nesta ordem)
1. FILTRO DE CONFIABILIDADE
   - Avalie a média de gols recente. Se for alta mas houver desfalques ofensivos relevantes, reduza confiança em mercados de gols.
   - Avalie a motivação: mata-mata, clássico, título ou rebaixamento → cautela.

2. CONFRONTO MODELO × MERCADO (CRÍTICO)
   - Compare "favorito_modelo" com "favorito_mercado".
   - Se divergirem: explique em "pontoAtencao" (fator casa, assimetria de liga, mata-mata, viagem, viés de amostra).

3. CONFRONTO DE DADOS
   - Compare expectativa estatística com momento defensivo/ofensivo recente; aponte divergência se as últimas 3-5 partidas mostrarem queda.

4. SÍNTESE POR MERCADO
   - Para CADA mercado em "mercados", entregue uma frase objetiva com leitura e direção.
   - Em "oddsReferencia", estime a odd justa do item; sinal de valor: odd real > odd justa.
   - Linguagem direta, português do Brasil. Sem emojis. Sem "IA", "algoritmo", "robô", "Poisson", "regressão".

# REGRAS ANTI-CONTRADIÇÃO (CRÍTICO)
- NUNCA Handicap +0.5/+1/+1.5/+2 para o favorito do mercado.
- NUNCA Handicap -0.5/-1/-1.5 para o azarão.
- Favorito: Vitória reta, Dupla Chance (favorito+empate) ou Handicap -0.25/-0.5.
- Azarão: Dupla Chance (azarão+empate), Empate Anula Aposta ou Handicap +0.5/+1.

# REGRAS ANTI-INVENÇÃO (CRÍTICO)
- Use APENAS números que aparecem em "fallback_stats.dados" ou no resto do payload. NUNCA invente médias, percentuais, xG, escanteios, cartões ou H2H.
- Se "fallback_stats.campos_ausentes" lista um campo (ex.: "avg_corners"), trate o mercado correspondente com linguagem qualitativa ("sem dado suficiente sobre escanteios", "tendência não confirmada") em vez de citar números.
- Se "fallback_stats.baixa_confianca" for true, comece "pontoAtencao" com: "Confiança estatística reduzida (fonte alternativa) — leitura conservadora."
- Se "fallback_stats.fonte" for "thesportsdb" ou "historical", evite cravar odds justas precisas; ofereça faixas ("entre 1.85 e 2.05") ou marque "—".

${DETAIL_SCHEMA_BLOCK}`;

const RESEARCH_SYSTEM_PROMPT = `Você é um Analista de Performance Esportiva e Especialista em Mercado Esportivo (Value Betting).

⚠️ MODO PESQUISA — A base estatística interna NÃO possui histórico desta partida (típico em amistosos, seleções, sub-categorias, Copa do Mundo). Compense com seu conhecimento real sobre as equipes, treinadores, plantel, lesões conhecidas, árbitro, contexto da competição e H2H.

# FONTES MENTAIS
- Últimos resultados de cada equipe/seleção.
- Momento dos principais jogadores (artilheiro, capitão, goleiro) e lesões.
- Treinador, esquema tático, postura.
- Árbitro quando souber.
- Tipo de jogo: amistoso (rotação), eliminatória, fase de grupos, mata-mata.
- H2H e rivalidade.

# FLUXO OBRIGATÓRIO
1. AVISO DE TRANSPARÊNCIA — em "pontoAtencao", comece exatamente com: "Leitura baseada em pesquisa externa (sem histórico estatístico interno desta partida)." Depois complemente.
2. CONTEXTO REAL — tipo de jogo e impacto na postura.
3. FORÇA RELATIVA — favorito técnico segundo o consenso, cruzando com a odd quando houver.
4. COBERTURA COMPLETA — preencha SEM EXCEÇÃO todos os campos de "mercados", "contextoDetalhado" e "oddsReferencia".
5. RISCO — em amistoso, padrão "medio" ou "alto".

# REGRAS
- Não invente estatísticas exatas. Use linguagem qualitativa ("tende a", "historicamente", "elenco mais qualificado").
- Português do Brasil, sem emojis, sem "IA"/"modelo"/"algoritmo".

# REGRAS ANTI-CONTRADIÇÃO
- NUNCA Handicap + para o favorito; NUNCA Handicap − para o azarão.
- Favorito: Vitória reta, Dupla Chance favorito+empate ou Handicap -0.25.
- Azarão: Dupla Chance azarão+empate, Empate Anula Aposta ou Handicap +0.5/+1.

${DETAIL_SCHEMA_BLOCK}`;

function pickFavorito(probs: { home?: number; draw?: number; away?: number } | null | undefined): string | null {
  if (!probs) return null;
  const h = Number(probs.home ?? 0);
  const d = Number(probs.draw ?? 0);
  const a = Number(probs.away ?? 0);
  const max = Math.max(h, d, a);
  if (max <= 0) return null;
  if (max === h) return "casa";
  if (max === a) return "fora";
  return "empate";
}

function pickFavoritoOdds(odds: { home?: number; draw?: number; away?: number }): string | null {
  const h = Number(odds.home ?? 0);
  const d = Number(odds.draw ?? 0);
  const a = Number(odds.away ?? 0);
  const valid = [
    { side: "casa", v: h },
    { side: "empate", v: d },
    { side: "fora", v: a },
  ].filter((x) => x.v > 1);
  if (!valid.length) return null;
  valid.sort((x, y) => x.v - y.v);
  return valid[0].side;
}

function normalizeProbs(p: any): { home: number; draw: number; away: number } | null {
  if (!p) return null;
  let h = Number(p.home ?? 0);
  let d = Number(p.draw ?? 0);
  let a = Number(p.away ?? 0);
  const sum = h + d + a;
  if (sum <= 0) return null;
  // se vier em 0-1, converte para %
  if (sum <= 1.5) { h *= 100; d *= 100; a *= 100; }
  return { home: Math.round(h), draw: Math.round(d), away: Math.round(a) };
}

function buildUserPayload(input: any): string {
  const m = input.match || {};
  const r = input.reading || {};
  const c = input.context || {};
  const odds = c.odds || {};
  const fb = input.fallbackStats || null;

  const probsPct = normalizeProbs(m.matchProbabilities);
  const favModelo = pickFavorito(probsPct);
  const favMercado = pickFavoritoOdds(odds);
  const divergencia =
    favModelo && favMercado && favModelo !== favMercado ? true : false;

  return JSON.stringify(
    {
      partida: {
        casa: m.homeTeam,
        fora: m.awayTeam,
        liga: m.league,
        horario: m.time,
        estadio: m.venue,
        fase: m.fixtureType,
      },
      favorito_modelo: favModelo,
      favorito_mercado: favMercado,
      divergencia_modelo_mercado: divergencia,
      probabilidades_modelo_pct: probsPct,
      projecao: {
        gols_projetados: r.projectedGoals,
        placares_provaveis: r.likelyScores,
        previsibilidade: r.predictability,
        qualidade_contexto: r.contextQuality,
      },
      resumo_tecnico: r.summary,
      leitura_tatica: r.tactical,
      tendencias: r.trendTags,
      insight_premium: r.premiumInsight,
      melhores_mercados: (r.opportunities || []).slice(0, 4).map((o: any) => ({
        mercado: o.market,
        confianca_pct: o.confidence,
        motivos: o.reasons,
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
      fallback_stats: fb ? {
        fonte: fb.source,
        confianca_pct: fb.confidence_score,
        baixa_confianca: fb.lowConfidence,
        campos_ausentes: fb.missing,
        dados: fb.stats,
      } : null,
    },
    null,
    0,
  );
}

function safeParseAnalyst(raw: string): any | null {
  if (!raw) return null;
  let txt = raw.trim();
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
    const pickStr = (v: any) => (typeof v === "string" ? v.trim() : "");
    const cd = obj.contextoDetalhado || obj.contexto_detalhado || {};
    const mk = obj.mercados || {};
    const od = obj.oddsReferencia || obj.odds_referencia || {};
    return {
      cenario,
      pontoAtencao,
      veredito,
      risco,
      contextoDetalhado: {
        desfalques: pickStr(cd.desfalques),
        arbitro: pickStr(cd.arbitro),
        clima: pickStr(cd.clima),
        motivacao: pickStr(cd.motivacao),
      },
      mercados: {
        vitoria: pickStr(mk.vitoria),
        duplaChance: pickStr(mk.duplaChance || mk.dupla_chance),
        handicap: pickStr(mk.handicap),
        overUnderGols: pickStr(mk.overUnderGols || mk.over_under_gols),
        btts: pickStr(mk.btts),
        escanteios: pickStr(mk.escanteios),
        cartoes: pickStr(mk.cartoes),
        placarExato: pickStr(mk.placarExato || mk.placar_exato),
      },
      oddsReferencia: {
        casa: pickStr(od.casa),
        empate: pickStr(od.empate),
        fora: pickStr(od.fora),
        over25: pickStr(od.over25),
        under25: pickStr(od.under25),
        bttsSim: pickStr(od.bttsSim || od.btts_sim),
        escanteiosOver9: pickStr(od.escanteiosOver9 || od.escanteios_over9),
        cartoesOver4: pickStr(od.cartoesOver4 || od.cartoes_over4),
      },
    };
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const fixtureId = body?.match?.id || body?.fixtureId;
    const pesquisaWeb = body?.pesquisaWeb === true;
    const modeTag = pesquisaWeb ? "research" : "standard";
    const cacheKey = fixtureId
      ? `analyst:${PROMPT_VERSION}:${modeTag}:${fixtureId}`
      : null;

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

    // Em modo pesquisa, payload mínimo (sem reading/context vazios) + odds se houver
    const userPayload = pesquisaWeb
      ? JSON.stringify({
          partida: {
            casa: body?.match?.homeTeam,
            fora: body?.match?.awayTeam,
            liga: body?.match?.league,
            horario: body?.match?.time,
            estadio: body?.match?.venue,
            fase: body?.match?.fixtureType,
          },
          mercado: body?.context?.odds
            ? {
                odds_1x2: {
                  casa: body.context.odds.home,
                  empate: body.context.odds.draw,
                  fora: body.context.odds.away,
                },
                over_under_25: {
                  over: body.context.odds.over25,
                  under: body.context.odds.under25,
                },
              }
            : null,
          observacao:
            "Sem histórico estatístico interno. Use seu conhecimento sobre as equipes/seleções.",
        })
      : buildUserPayload(body);

    const systemPrompt = pesquisaWeb ? RESEARCH_SYSTEM_PROMPT : SYSTEM_PROMPT;
    const model = pesquisaWeb ? "google/gemini-2.5-pro" : "google/gemini-2.5-flash";
    const userPrefix = pesquisaWeb
      ? "Analise a partida abaixo em MODO PESQUISA usando seu conhecimento sobre as equipes. Devolva apenas o JSON.\n\n"
      : "Analise a partida abaixo seguindo o fluxo. Devolva apenas o JSON.\n\n";

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrefix + userPayload },
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
