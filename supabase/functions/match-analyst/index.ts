// ════════════════════════════════════════════════════════════════
// match-analyst
// Camada de interpretação humana (Analista de Performance Esportiva
// + Especialista em Valor de Mercado) por cima da leitura técnica
// já gerada pelo readingEngine. Usa Lovable AI Gateway.
// Saída estruturada: { cenario, pontoAtencao, veredito, risco }
// ════════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";


import { corsHeaders } from '../_shared/cors.ts';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min
const PROMPT_VERSION = "v7"; // odds de referência sempre numéricas, mesmo sem odds da API

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
    "casa": "Odd justa estimada para vitória da casa, SEMPRE numérica (ex: '2.10'). Nunca '—'.",
    "empate": "Odd justa estimada para empate, sempre numérica.",
    "fora": "Odd justa estimada para vitória visitante, sempre numérica.",
    "over25": "Odd justa estimada para Over 2.5, sempre numérica.",
    "under25": "Odd justa estimada para Under 2.5, sempre numérica.",
    "bttsSim": "Odd justa estimada para ambas marcam Sim, sempre numérica.",
    "escanteiosOver9": "Odd justa estimada para Over 9.5 escanteios, sempre numérica.",
    "cartoesOver4": "Odd justa estimada para Over 4.5 cartões, sempre numérica."
  }
}`;

const SENIOR_ANALYST_DIRECTIVES = `# POSTURA — ANALISTA SÊNIOR (OBRIGATÓRIO)
Atue como analista de dados esportivos sênior em Poisson, xG e gestão de risco para trading.

1. ANÁLISE DE VALOR (não de probabilidade pura)
   - Não basta dizer a probabilidade. Compare probabilidade estatística estimada × cotação real do mercado e indique onde existe disparidade (valor matemático).
   - Se a odd real ≥ odd justa estimada → sinalize "valor"; caso contrário → "sem valor" ou "preço justo".

2. CETICISMO ESTATÍSTICO
   - Se a amostra (jogos recentes, H2H, dados disponíveis) for pequena/ruidosa, declare abertamente baixa confiança e recomende cautela ou "Evitar Entrada".
   - Nunca force conclusão estatística sobre amostra insuficiente.

3. HIERARQUIA DE VARIÁVEIS (priorize nesta ordem)
   (1) Escalações confirmadas e desfalques relevantes
   (2) xG / médias ofensivas e defensivas dos últimos 5 jogos
   (3) H2H recente relevante
   (4) Contexto da competição (motivação, mata-mata, calendário)

4. IDENTIFICAÇÃO DE INCONSISTÊNCIAS
   - Se o cenário tático (ex.: jogo estudado, fechado) contradisser uma recomendação de mercado (ex.: Over 0.5 HT com alta confiança), destaque a contradição em "pontoAtencao" e explique qual variável causa o desequilíbrio.

5. FORMATO DOS CAMPOS NARRATIVOS
   - "cenario" → começa com "Resumo Tático:" e traz 3 linhas sobre a dinâmica esperada.
   - "pontoAtencao" → começa com "Diagnóstico de Valor:" listando pontos fortes e riscos ocultos (gols, escanteios, cartões, contradições modelo×mercado).
   - "veredito" → começa com "Veredito Profissional:" seguido de UMA recomendação clara entre: "Entrada com Valor", "Aguardar Live" ou "Evitar Entrada", com mercado específico e justificativa de valor (odd × probabilidade).
   - Tom profissional, direto e técnico. Sem emojis, sem hype, sem "IA/algoritmo/modelo/Poisson/regressão" expostos ao leitor.
`;

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

# REGRAS DE ODDS DE REFERÊNCIA (OBRIGATÓRIO)
- SEMPRE preencha TODOS os campos numéricos em "oddsReferencia" com uma estimativa de odd justa real (ex.: "1.95", "2.40", "3.10"). NUNCA devolva "—" nem texto vazio.
- Se "mercado.odds_1x2" vier preenchido, use-o como âncora; ajuste levemente conforme sua leitura para indicar valor.
- Se NÃO houver odds reais no payload (mercado vazio ou null), estime as odds a partir das probabilidades do modelo, da projeção de gols, do favorito e da força relativa das equipes — convertendo probabilidade em odd justa (odd ≈ 1 / probabilidade). Sempre devolva um número, mesmo quando "fallback_stats.fonte" for "thesportsdb" ou "historical".
- Use valores realistas de mercado esportivo (faixa típica: 1.10 a 15.00). Mantenha coerência entre os mercados (ex.: soma de 1/casa + 1/empate + 1/fora ≈ 1.05–1.15 para incluir margem da casa).

${SENIOR_ANALYST_DIRECTIVES}

${DETAIL_SCHEMA_BLOCK}`;

const RESEARCH_SYSTEM_PROMPT = `Você é o NEXUS RESEARCH ANALYST — a única IA do sistema responsável por pesquisa externa em tempo real.

⚠️ REGRA DE PESQUISA — Você DEVE usar a ferramenta google_search (já disponível no Gemini) para investigar a partida na internet. Toda informação externa (notícias, lesões, suspensões, escalações prováveis, motivação, situação na tabela, árbitro, contexto da competição, movimentação de mercado, H2H recente, momento dos times) PRECISA vir da web — nunca invente.

# FONTES OBRIGATÓRIAS A PESQUISAR
- Notícias recentes (últimos 7 dias) sobre as duas equipes.
- Lesões e suspensões confirmadas (sites oficiais dos clubes, ESPN, Globoesporte, BBC Sport, Sky Sports, OneFootball, Transfermarkt).
- Escalação provável (SofaScore, Lance, Goal, Marca, AS, L'Équipe).
- Situação na tabela e importância da partida (mata-mata, briga por título, fuga do rebaixamento, amistoso).
- Árbitro escalado e perfil (média de cartões/pênaltis), quando divulgado.
- Mercado de odds reais: Bet365, Pinnacle, Betfair, OddsPortal, Academia das Apostas, SofaScore.
- Confronto direto (H2H) recente.
- Forma das últimas 5 partidas oficiais de cada lado.

# COMPORTAMENTO OBRIGATÓRIO
1. Pesquisa em segundo plano: o usuário recebe SOMENTE o resultado final consolidado. Não exponha etapas de busca.
2. Cruze 2+ fontes antes de afirmar lesão/suspensão/escalação.
3. AVISO DE TRANSPARÊNCIA — em "pontoAtencao", comece com: "Leitura baseada em pesquisa externa em tempo real."
4. COBERTURA COMPLETA — preencha SEM EXCEÇÃO todos os campos de "mercados", "contextoDetalhado" e "oddsReferencia" com dados pesquisados.
5. Odds reais: prefira odds capturadas em casas reais; se não achar a odd exata, estime a partir das probabilidades reportadas (nunca devolva "—").
6. Se UM dado específico não aparecer em nenhuma fonte, escreva "não confirmado" naquele campo, sem inventar nomes/números.

# REGRAS DE OURO
- NUNCA peça ao usuário para conectar Perplexity, Firecrawl, SerpAPI ou qualquer novo connector/API key.
- NUNCA mencione "IA", "modelo", "algoritmo", "Poisson", "regressão", "Gemini" no corpo da resposta.
- Português do Brasil, sem emojis, tom de analista profissional.

# REGRAS ANTI-CONTRADIÇÃO
- NUNCA Handicap + para o favorito; NUNCA Handicap − para o azarão.
- Favorito: Vitória reta, Dupla Chance favorito+empate ou Handicap -0.25.
- Azarão: Dupla Chance azarão+empate, Empate Anula Aposta ou Handicap +0.5/+1.

${SENIOR_ANALYST_DIRECTIVES}

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

function localAnalyst(input: any, reason = "rate_limited") {
  const m = input?.match || {};
  const s = input?.fallbackStats?.stats || {};
  const home = m.homeTeam || "Mandante";
  const away = m.awayTeam || "Visitante";
  const avgGoals = Number(s.avg_goals ?? input?.reading?.projectedGoals ?? 2.2);
  const over25 = Number(s.over25_pct ?? 50);
  const btts = Number(s.btts_pct ?? 50);
  const homeForm = s.home_form || "sem sequência confirmada";
  const awayForm = s.away_form || "sem sequência confirmada";
  const h2hCount = Array.isArray(s.h2h) ? s.h2h.length : 0;
  const risk = input?.fallbackStats?.lowConfidence ? "alto" : avgGoals >= 2.8 || over25 >= 60 ? "medio" : "baixo";
  const overLean = over25 >= 58 ? "Over 2.5" : avgGoals <= 2.1 ? "Under 2.5" : "Over 1.5";
  const bttsLean = btts >= 55 ? "BTTS Sim" : "BTTS Não/entrada conservadora";
  const overProb = Math.min(0.78, Math.max(0.28, over25 / 100 || avgGoals / 4.8));
  const bttsProb = Math.min(0.76, Math.max(0.25, btts / 100 || 0.5));
  const homeProb = Math.min(0.55, Math.max(0.28, 0.38 + (String(homeForm).replace(/[^W]/g, "").length - String(awayForm).replace(/[^W]/g, "").length) * 0.04));
  const awayProb = Math.min(0.48, Math.max(0.22, 0.34 + (String(awayForm).replace(/[^W]/g, "").length - String(homeForm).replace(/[^W]/g, "").length) * 0.04));
  const drawProb = Math.max(0.18, 1 - homeProb - awayProb);
  const odd = (p: number) => (1 / Math.min(0.9, Math.max(0.08, p))).toFixed(2);
  const sourceText = reason === "rate_limited"
    ? "Leitura gerada pelo motor estatístico local porque o provedor externo atingiu limite temporário."
    : "Leitura gerada pelo motor estatístico local.";
  return {
    cenario: `${home} x ${away} tem média recente de ${avgGoals.toFixed(1)} gols e formas ${homeForm} x ${awayForm}. ${sourceText} O confronto direto possui ${h2hCount} registro(s) úteis na base quando disponível.`,
    pontoAtencao: `${input?.fallbackStats?.missing?.length ? `Campos ausentes: ${input.fallbackStats.missing.join(", ")}. ` : ""}Sem dado completo de escanteios/cartões, esses mercados devem ser tratados com stake menor. A leitura principal fica concentrada em gols, BTTS e proteção de resultado.`,
    veredito: `Entrada principal sugerida: ${overLean}, com ${bttsLean} como leitura secundária. Evite forçar vencedor seco se a odd não estiver acima da odd justa estimada.`,
    risco: risk,
    contextoDetalhado: {
      desfalques: "Sem desfalques relevantes confirmados na base estatística atual.",
      arbitro: "Árbitro não confirmado; mercado de cartões sem validação numérica suficiente.",
      clima: "Sem informação climática relevante integrada ao jogo.",
      motivacao: "Motivação avaliada pelo tipo de competição e momento recente das equipes.",
    },
    mercados: {
      vitoria: `Casa ${odd(homeProb)}, empate ${odd(drawProb)} e fora ${odd(awayProb)} como referência justa; prefira proteção se houver divergência de mercado.`,
      duplaChance: homeProb >= awayProb ? "1X é a proteção mais coerente pelo recorte estatístico." : "X2 é a proteção mais coerente pelo recorte estatístico.",
      handicap: homeProb >= awayProb ? "Favorito: handicap -0.25 apenas se o preço pagar o risco; alternativa conservadora 0.0." : "Visitante/azarão: handicap +0.5 ou empate anula aposta.",
      overUnderGols: `Tendência principal em ${overLean}; média recente ${avgGoals.toFixed(1)} e Over 2.5 em ${over25.toFixed(1)}%.`,
      btts: `${bttsLean}; ambas marcam aparece em ${btts.toFixed(1)}% no recorte disponível.`,
      escanteios: "Sem média confiável de escanteios; aguardar leitura ao vivo de pressão/laterais antes de entrada.",
      cartoes: "Sem árbitro e sem média confiável de cartões; evitar linha pré-jogo agressiva.",
      placarExato: avgGoals >= 2.7 ? "2-1, 1-2, 2-2" : "1-1, 1-0, 0-1",
    },
    oddsReferencia: {
      casa: odd(homeProb),
      empate: odd(drawProb),
      fora: odd(awayProb),
      over25: odd(overProb),
      under25: odd(1 - overProb),
      bttsSim: odd(bttsProb),
      escanteiosOver9: "2.05",
      cartoesOver4: "2.10",
    },
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const t0 = Date.now();
  const auditLog: Record<string, any> = {
    stage: "init", match_id: null, league: null, home_team: null, away_team: null,
    pesquisaWeb: false, missing_fields: [], fallback_source: null,
    fallback_confidence: null, fallback_low_confidence: null,
    gemini_status: "not_called", groq_status: "not_called", lovable_status: "not_called",
    provider_used: null, fallback_reason: null, execution_time_ms: 0,
  };
  const emitAudit = (extra: Record<string, any> = {}) => {
    Object.assign(auditLog, extra, { execution_time_ms: Date.now() - t0 });
    console.log("[match-analyst][AUDIT]", JSON.stringify(auditLog));
  };

  try {
    const body = await req.json();
    const fixtureId = body?.match?.id || body?.fixtureId;
    const pesquisaWeb = body?.pesquisaWeb === true;
    const modeTag = pesquisaWeb ? "research" : "standard";
    const cacheKey = fixtureId ? `analyst:${PROMPT_VERSION}:${modeTag}:${fixtureId}` : null;

    auditLog.match_id = fixtureId ?? null;
    auditLog.league = body?.match?.league ?? null;
    auditLog.home_team = body?.match?.homeTeam ?? null;
    auditLog.away_team = body?.match?.awayTeam ?? null;
    auditLog.pesquisaWeb = pesquisaWeb;
    auditLog.missing_fields = body?.fallbackStats?.missing ?? [];
    auditLog.fallback_source = body?.fallbackStats?.source ?? null;
    auditLog.fallback_confidence = body?.fallbackStats?.confidence_score ?? null;
    auditLog.fallback_low_confidence = body?.fallbackStats?.lowConfidence ?? null;

    console.log("[match-analyst][stage=received]", JSON.stringify({
      match_id: auditLog.match_id, home: auditLog.home_team, away: auditLog.away_team,
      league: auditLog.league, pesquisaWeb,
      fallback_source: auditLog.fallback_source, missing_fields: auditLog.missing_fields,
      reading_keys: Object.keys(body?.reading || {}),
      context_keys: Object.keys(body?.context || {}),
    }));

    if (cacheKey) {
      const cached = await cacheGet(cacheKey);
      if (cached) {
        emitAudit({ stage: "cache_hit", provider_used: cached._source || "cache" });
        return new Response(JSON.stringify({ ...cached, cached: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const groqKey = Deno.env.get("GROQ_API_KEY");
    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!groqKey && !geminiKey && !lovableKey) {
      const local = localAnalyst(body, "no_ai_key");
      emitAudit({ stage: "no_keys", provider_used: "local", fallback_reason: "no_ai_key" });
      return new Response(JSON.stringify({ ...local, _source: "local", _fallback_reason: "no_ai_key" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userPayload = pesquisaWeb
      ? JSON.stringify({
          partida: {
            casa: body?.match?.homeTeam, fora: body?.match?.awayTeam,
            liga: body?.match?.league, horario: body?.match?.time,
            estadio: body?.match?.venue, fase: body?.match?.fixtureType,
          },
          mercado: body?.context?.odds ? {
            odds_1x2: { casa: body.context.odds.home, empate: body.context.odds.draw, fora: body.context.odds.away },
            over_under_25: { over: body.context.odds.over25, under: body.context.odds.under25 },
          } : null,
          observacao: "Sem histórico estatístico interno. Use seu conhecimento sobre as equipes/seleções.",
        })
      : buildUserPayload(body);

    const systemPrompt = pesquisaWeb ? RESEARCH_SYSTEM_PROMPT : SYSTEM_PROMPT;
    const userPrefix = pesquisaWeb
      ? "Analise a partida abaixo em MODO PESQUISA usando seu conhecimento sobre as equipes. Devolva apenas o JSON.\n\n"
      : "Analise a partida abaixo seguindo o fluxo. Devolva apenas o JSON.\n\n";

    console.log("[match-analyst][stage=prompt_built]", JSON.stringify({
      mode: modeTag, system_prompt_chars: systemPrompt.length, user_payload_chars: userPayload.length,
    }));

    type ProviderResult = { content: string; source: string } | null;
    const failureReasons: Record<string, string> = {};

    async function tryGroq(): Promise<ProviderResult> {
      if (!groqKey) { auditLog.groq_status = "no_key"; return null; }
      const tg = Date.now();
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 18000);
        const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST", signal: ctrl.signal,
          headers: { Authorization: `Bearer ${groqKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "llama-3.3-70b-versatile", temperature: 0.5, max_tokens: 3000,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrefix + userPayload },
            ],
          }),
        });
        clearTimeout(t);
        auditLog.groq_status = `http_${resp.status}`;
        if (!resp.ok) {
          const errBody = await resp.text();
          const reason = resp.status === 429 ? "rate_limit"
            : resp.status === 401 ? "auth_error"
            : (resp.status === 408 || resp.status === 504) ? "timeout"
            : `provider_error:${resp.status}`;
          failureReasons.groq = reason;
          console.warn("[match-analyst][groq] ERROR_FULL_PAYLOAD", errBody);
          return null;
        }
        const data = await resp.json();
        const content = data?.choices?.[0]?.message?.content || "";
        console.log("[match-analyst][groq] ok", JSON.stringify({ ms: Date.now() - tg, chars: content.length }));
        return content ? { content, source: "groq" } : null;
      } catch (e: any) {
        auditLog.groq_status = e?.name === "AbortError" ? "timeout" : "exception";
        failureReasons.groq = e?.name === "AbortError" ? "timeout" : `exception:${e?.message || e}`;
        return null;
      }
    }

    async function tryGemini(): Promise<ProviderResult> {
      if (!geminiKey) { auditLog.gemini_status = "no_key"; return null; }
      try {
        const model = pesquisaWeb ? "gemini-2.5-pro" : "gemini-2.5-flash";
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
        const reqBody: any = {
          system_instruction: { parts: [{ text: systemPrompt + (pesquisaWeb ? "\n\nIMPORTANTE: Use a ferramenta google_search para buscar ODDS REAIS atuais (Bet365, Pinnacle, Betfair, OddsPortal, SofaScore, Academia das Apostas) e estatísticas recentes das equipes nesta partida específica. Preencha 'oddsReferencia' com odds reais encontradas. Devolva SOMENTE JSON puro (sem markdown, sem ```), começando com { e terminando com }." : "") }] },
          contents: [{ role: "user", parts: [{ text: userPrefix + userPayload }] }],
          generationConfig: { temperature: 0.6, ...(pesquisaWeb ? {} : { responseMimeType: "application/json" }) },
          ...(pesquisaWeb ? { tools: [{ google_search: {} }] } : {}),
        };
        const tgem = Date.now();
        const resp = await fetch(url, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reqBody),
        });
        const rawText = await resp.text();
        auditLog.gemini_status = `http_${resp.status}`;
        console.log("[match-analyst][gemini] request", JSON.stringify({
          model, endpoint: url.replace(geminiKey, "***"),
          pesquisaWeb, usesGoogleSearch: !!pesquisaWeb, usesGrounding: !!pesquisaWeb,
          retries: 0, callsPerAnalysis: 1,
          status: resp.status, statusText: resp.statusText, durationMs: Date.now() - tgem,
        }));
        if (!resp.ok) {
          console.error("[match-analyst][gemini] ERROR_FULL_PAYLOAD", rawText);
          let detailedReason = `provider_error:${resp.status}`;
          try {
            const errJson = JSON.parse(rawText);
            const code = errJson?.error?.code;
            const status = errJson?.error?.status;
            console.error("[match-analyst][gemini] ERROR_PARSED", JSON.stringify(errJson, null, 2));
            if (status === "RESOURCE_EXHAUSTED" || code === 429) detailedReason = "quota_exceeded";
            else if (status === "PERMISSION_DENIED") detailedReason = "permission_denied";
            else if (status === "UNAUTHENTICATED" || code === 401) detailedReason = "auth_error";
            else if (status === "INVALID_ARGUMENT") detailedReason = "invalid_argument";
            else if (status === "FAILED_PRECONDITION") detailedReason = "billing_required";
          } catch { /* not json */ }
          failureReasons.gemini = detailedReason;
          return null;
        }
        const data = JSON.parse(rawText);
        const parts = data?.candidates?.[0]?.content?.parts || [];
        const content = parts.map((p: any) => p?.text || "").join("");
        if (!content) failureReasons.gemini = "empty_response";
        return content ? { content, source: "gemini" } : null;
      } catch (e: any) {
        auditLog.gemini_status = e?.name === "AbortError" ? "timeout" : "exception";
        failureReasons.gemini = e?.name === "AbortError" ? "timeout" : `exception:${e?.message || e}`;
        return null;
      }
    }

    async function tryLovable(): Promise<ProviderResult> {
      if (!lovableKey) { auditLog.lovable_status = "no_key"; return null; }
      try {
        const model = pesquisaWeb ? "google/gemini-2.5-pro" : "google/gemini-2.5-flash";
        const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrefix + userPayload },
            ],
            response_format: { type: "json_object" },
          }),
        });
        auditLog.lovable_status = `http_${resp.status}`;
        if (!resp.ok) {
          const txt = await resp.text();
          failureReasons.lovable = resp.status === 429 ? "rate_limit" : `provider_error:${resp.status}`;
          console.warn("[match-analyst][lovable] fail", resp.status, txt.slice(0, 200));
          return null;
        }
        const data = await resp.json();
        const content = data?.choices?.[0]?.message?.content || "";
        return content ? { content, source: "lovable" } : null;
      } catch (e: any) {
        auditLog.lovable_status = "exception";
        failureReasons.lovable = `exception:${e?.message || e}`;
        return null;
      }
    }

    let result: ProviderResult = null;
    if (pesquisaWeb) {
      result = await tryGemini();
    } else {
      result = await tryGroq();
      if (!result) result = await tryGemini();
      if (!result) result = await tryLovable();
    }

    if (!result) {
      const reason = pesquisaWeb
        ? (failureReasons.gemini || "research_unavailable")
        : (failureReasons.groq || failureReasons.gemini || failureReasons.lovable || "ai_error");
      const hasStats = !!(body?.fallbackStats?.stats && Object.values(body.fallbackStats.stats).some((v: any) => v !== null && v !== undefined));
      const local = localAnalyst(body, reason);
      if (pesquisaWeb) {
        local.pontoAtencao = "Pesquisa externa temporariamente indisponível. Análise realizada apenas com os dados disponíveis. " + local.pontoAtencao;
      }
      emitAudit({
        stage: "fallback_local", provider_used: "local",
        fallback_reason: reason, provider_failure_reasons: failureReasons, has_real_stats: hasStats,
      });
      if (cacheKey) await cacheSet(cacheKey, local);
      return new Response(JSON.stringify({
        ...local,
        _source: pesquisaWeb ? "local_research_unavailable" : "local",
        _fallback_reason: reason,
        _provider_failures: failureReasons,
        _generic_warning: !hasStats,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const parsed = safeParseAnalyst(result.content);
    if (!parsed) {
      console.warn("[match-analyst][parse_fail] src=", result.source, result.content?.slice(0, 300));
      const local = localAnalyst(body, "parse_fail");
      emitAudit({ stage: "parse_fail", provider_used: "local", fallback_reason: "parse_fail", attempted_source: result.source });
      if (cacheKey) await cacheSet(cacheKey, local);
      return new Response(JSON.stringify({ ...local, _source: "local", _fallback_reason: "parse_fail", _attempted_source: result.source }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    (parsed as any)._source = result.source;
    if (cacheKey) await cacheSet(cacheKey, parsed);
    emitAudit({ stage: "success", provider_used: result.source });

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[match-analyst][fatal]", e);
    emitAudit({ stage: "fatal", fallback_reason: `fatal:${e?.message || e}` });
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
