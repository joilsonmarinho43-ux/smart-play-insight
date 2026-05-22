import { analyzeMarkets } from "./matchAnalysis";
import type { MatchData, MarketAnalysis } from "@/types/match";

// ─── Tipos ────────────────────────────────────────────────────
export interface MatchContext {
  lineups?: {
    home: { formation: string | null; coach: string | null; confirmed: boolean };
    away: { formation: string | null; coach: string | null; confirmed: boolean };
    source: "oficial" | "estimado";
  };
  injuries?: {
    home: { count: number; players: any[]; impact: "baixo" | "médio" | "alto" };
    away: { count: number; players: any[]; impact: "baixo" | "médio" | "alto" };
  };
  motivation?: {
    home: { stake: string; rank: number | null };
    away: { stake: string; rank: number | null };
  };
  fatigue?: {
    home: { gamesLast10d: number; restDays: number | null } | null;
    away: { gamesLast10d: number; restDays: number | null } | null;
  };
  odds?: {
    home: number | null;
    draw: number | null;
    away: number | null;
    over25: number | null;
    under25: number | null;
    bttsYes: number | null;
    bttsNo: number | null;
  } | null;
  reliability?: "completo" | "parcial" | "limitado";
}

export interface ReadingOpportunity {
  market: string;
  confidence: number;
  reasons: string[];
}

export interface MatchReadingV2 {
  summary: string;
  tactical: string;
  indicators: string[];
  marketRead: string;
  opportunities: ReadingOpportunity[];
  alerts: string[];
  likelyScores: string[];
  timing: { pressure: string; acceleration: string; opening: string };
  predictability: "verde" | "amarelo" | "vermelho";
  verdict: string;
  contextQuality: "completo" | "parcial" | "limitado";
}

// ─── Math ─────────────────────────────────────────────────────
function fact(n: number) {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}
function poisson(l: number, k: number) {
  return (Math.exp(-l) * Math.pow(l, k)) / fact(k);
}
function bayes(avg: number, league: number, n: number, k = 3) {
  if (n <= 0) return league;
  return (n * avg + k * league) / (n + k);
}
function topScores(hL: number, aL: number, n = 3) {
  const items: { s: string; p: number }[] = [];
  for (let h = 0; h <= 5; h++)
    for (let a = 0; a <= 5; a++)
      items.push({ s: `${h}-${a}`, p: poisson(hL, h) * poisson(aL, a) });
  items.sort((x, y) => y.p - x.p);
  return items.slice(0, n).map((i) => i.s);
}
function fmt(n: number, d = 1) {
  return Number.isFinite(n) ? n.toFixed(d) : "—";
}
function pick<T>(arr: T[], seed: number): T {
  return arr[Math.abs(seed) % arr.length];
}

// ─── Engine ───────────────────────────────────────────────────
export function buildMatchReadingV2(
  match: MatchData,
  ctx?: MatchContext | null,
): MatchReadingV2 | null {
  const home = match.homeTeam || "Mandante";
  const away = match.awayTeam || "Visitante";

  const md: any = match.modelData || {};
  const hs: any = (match as any).homeStats || {};
  const as_: any = (match as any).awayStats || {};

  const hGF = md.homeGoalsAvg ?? hs.goalsFor ?? null;
  const aGF = md.awayGoalsAvg ?? as_.goalsFor ?? null;
  const hGA = md.homeGoalsAgainstAvg ?? hs.goalsAgainst ?? null;
  const aGA = md.awayGoalsAgainstAvg ?? as_.goalsAgainst ?? null;
  const hCorners = md.homeCornersAvg ?? hs.corners ?? null;
  const aCorners = md.awayCornersAvg ?? as_.corners ?? null;
  const hCards = md.homeCardsAvg ?? hs.yellowCards ?? null;
  const aCards = md.awayCardsAvg ?? as_.yellowCards ?? null;
  const homeN = match.sampleSize?.homeGames ?? hs.gamesCount ?? 0;
  const awayN = match.sampleSize?.awayGames ?? as_.gamesCount ?? 0;
  const leagueAvg = hs.leagueAvg ?? as_.leagueAvg ?? 1.3;

  if (hGF == null || aGF == null || hGA == null || aGA == null) return null;
  if (homeN <= 0 && awayN <= 0) return null;

  const adjHGF = bayes(hGF, leagueAvg, homeN);
  const adjAGA = bayes(aGA, leagueAvg, awayN);
  const adjAGF = bayes(aGF, leagueAvg, awayN);
  const adjHGA = bayes(hGA, leagueAvg, homeN);

  const hL =
    adjHGF > 0 && adjAGA > 0
      ? (adjHGF / leagueAvg) * (adjAGA / leagueAvg) * leagueAvg
      : adjHGF;
  const aL =
    adjAGF > 0 && adjHGA > 0
      ? (adjAGF / leagueAvg) * (adjHGA / leagueAvg) * leagueAvg
      : adjAGF;
  const total = hL + aL;
  const diff = hL - aL;

  let markets: MarketAnalysis[] = [];
  try {
    markets = analyzeMarkets(match);
  } catch {
    markets = [];
  }
  if (markets.length === 0) return null;

  const o25 = markets.find((m) => m.market === "Over 2.5 Gols")?.probability ?? 0;
  const btts = markets.find((m) => m.market === "Ambas Marcam")?.probability ?? 0;

  // Context impact
  const homeImpact = ctx?.injuries?.home?.impact || "baixo";
  const awayImpact = ctx?.injuries?.away?.impact || "baixo";
  const ctxReliab = ctx?.reliability || "limitado";
  const homeMot = ctx?.motivation?.home?.stake || null;
  const awayMot = ctx?.motivation?.away?.stake || null;
  const homeRank = ctx?.motivation?.home?.rank || null;
  const awayRank = ctx?.motivation?.away?.rank || null;
  const homeRest = ctx?.fatigue?.home?.restDays;
  const awayRest = ctx?.fatigue?.away?.restDays;
  const homeLoad = ctx?.fatigue?.home?.gamesLast10d ?? 0;
  const awayLoad = ctx?.fatigue?.away?.gamesLast10d ?? 0;

  const seed = Math.round(hL * 100 + aL * 50 + (homeN + awayN));

  // ─── 1. Summary ─────────────────────────────────────────────
  const stronger = diff > 0.25 ? home : diff < -0.25 ? away : null;
  const weaker = stronger === home ? away : stronger === away ? home : null;

  let summary = "";
  if (stronger) {
    const base = pick(
      [
        `${stronger} chega tecnicamente superior a ${weaker} considerando os números recentes.`,
        `Olhando o panorama, o favoritismo é do ${stronger} contra o ${weaker} — mas vale entender o contexto.`,
        `${stronger} tem a vantagem nos números frente ao ${weaker}, ainda assim a leitura pede atenção.`,
      ],
      seed,
    );
    let mod = "";
    const strongerImpact =
      stronger === home ? homeImpact : awayImpact;
    if (strongerImpact === "alto")
      mod = ` A baixa de jogadores importantes reduz parte do favoritismo esperado.`;
    else if (strongerImpact === "médio")
      mod = ` Algumas ausências relevantes podem custar ritmo na criação.`;
    const strongerLoad = stronger === home ? homeLoad : awayLoad;
    if (strongerLoad >= 3)
      mod += ` O calendário pesado das últimas semanas tende a cobrar fisicamente.`;
    summary =
      base +
      mod +
      ` A expectativa é de ${total >= 2.9 ? "um jogo aberto" : total >= 2.3 ? "uma partida de ritmo equilibrado" : "um jogo truncado"}, com cerca de ${fmt(total)} gols somados.`;
  } else {
    summary = pick(
      [
        `Confronto bem nivelado entre ${home} e ${away} — não há favorito evidente nos números.`,
        `${home} e ${away} chegam em condições parecidas. Pequenos detalhes devem decidir.`,
      ],
      seed,
    );
    summary += ` Projeção de ${fmt(total)} gols na soma, com cenário ${total >= 2.7 ? "ofensivo" : "mais cauteloso"}.`;
  }

  // ─── 2. Tactical ────────────────────────────────────────────
  const homeAttack = hGF >= 1.6;
  const awayAttack = aGF >= 1.4;
  const homeSolid = hGA <= 1.0;
  const awaySolid = aGA <= 1.0;

  let tactical = "";
  if (homeAttack && !awaySolid) {
    tactical = `Tendência de ${home} mais vertical e agressivo desde os primeiros minutos, com o ${away} sofrendo para conter o avanço.`;
  } else if (awayAttack && !homeSolid) {
    tactical = `${away} deve explorar transições e tem espaço para incomodar o ${home}, que tem mostrado fragilidade defensiva.`;
  } else if (homeSolid && awaySolid) {
    tactical = `Duas equipes defensivamente organizadas. Espera-se jogo posicional, com poucos espaços e bola disputada no meio.`;
  } else {
    tactical = `O ${home} tende a impor o ritmo em casa, enquanto o ${away} deve baixar linhas e apostar em jogadas pontuais.`;
  }
  if (ctx?.lineups?.home?.formation && ctx?.lineups?.away?.formation) {
    tactical += ` Provável esquema: ${home} ${ctx.lineups.home.formation} × ${ctx.lineups.away.formation} ${away}.`;
  }

  // ─── 3. Indicators (relevantes apenas) ──────────────────────
  const indicators: string[] = [];
  indicators.push(
    `${home} marca ${fmt(hGF)} e sofre ${fmt(hGA)} por jogo (últimas ${homeN} partidas).`,
  );
  indicators.push(
    `${away} marca ${fmt(aGF)} e sofre ${fmt(aGA)} por jogo (últimas ${awayN}).`,
  );
  if (total >= 2.9)
    indicators.push(`Projeção combinada elevada: ${fmt(total)} gols esperados.`);
  if (hGA >= 1.5 && aGA >= 1.5)
    indicators.push(`As duas defesas vêm vazando bastante — cenário favorável a jogo aberto.`);
  if (hCorners != null && aCorners != null && hCorners + aCorners >= 10)
    indicators.push(`Alta média de escanteios somada: ${fmt(hCorners + aCorners)} por jogo.`);
  if (hCards != null && aCards != null && hCards + aCards >= 5)
    indicators.push(`Tendência de jogo físico — média de ${fmt(hCards + aCards)} amarelos por partida.`);
  if (homeImpact === "alto")
    indicators.push(`Desfalques relevantes no ${home} reduzem força no setor ofensivo/defensivo.`);
  if (awayImpact === "alto")
    indicators.push(`Desfalques importantes no ${away} pesam contra.`);
  if (homeMot === "luta contra rebaixamento")
    indicators.push(`${home} luta contra o rebaixamento — entrega física máxima esperada.`);
  if (awayMot === "luta contra rebaixamento")
    indicators.push(`${away} luta contra o rebaixamento — tende a se entregar mesmo fora.`);
  if (homeMot === "disputa por título" && homeRank)
    indicators.push(`${home} é ${homeRank}º na tabela e briga pelo título.`);
  if (awayMot === "disputa por título" && awayRank)
    indicators.push(`${away} (${awayRank}º) joga pressionado pela ponta da tabela.`);
  if (homeRest != null && homeRest <= 2)
    indicators.push(`${home} jogou há apenas ${homeRest} dia(s) — desgaste pode aparecer.`);
  if (awayRest != null && awayRest <= 2)
    indicators.push(`${away} chega com pouca recuperação (${awayRest}d desde o último jogo).`);

  // ─── 4. Market read ─────────────────────────────────────────
  const oddH = ctx?.odds?.home;
  const oddA = ctx?.odds?.away;
  const oddO = ctx?.odds?.over25;
  const impH = oddH ? 1 / oddH : null;
  const impA = oddA ? 1 / oddA : null;

  const bits: string[] = [];
  if (oddH && oddA) {
    if (oddH < oddA && stronger !== home)
      bits.push(`O mercado coloca o ${home} como favorito (${oddH.toFixed(2)}), mas os números não confirmam esse peso — possível linha inflada.`);
    else if (oddA < oddH && stronger !== away)
      bits.push(`As odds favorecem o ${away} (${oddA.toFixed(2)}), porém o cenário estatístico é equilibrado — atenção a armadilha.`);
    else
      bits.push(`O mercado reconhece o favoritismo já apontado pelos números (${home} ${oddH.toFixed(2)} × ${oddA.toFixed(2)} ${away}).`);
  }
  if (oddO && o25) {
    const implied = (1 / oddO) * 100;
    if (o25 - implied >= 8)
      bits.push(`A linha de Over 2.5 (${oddO.toFixed(2)}) parece subdimensionada frente à projeção real (${o25}%) — bom valor.`);
    else if (implied - o25 >= 8)
      bits.push(`Over 2.5 está caro para o cenário (${o25}% real vs ${implied.toFixed(0)}% implícita).`);
    else
      bits.push(`Linha de gols precificada de forma justa pelo mercado.`);
  } else if (o25 >= 65)
    bits.push(`Sem odd disponível, mas o modelo indica Over 2.5 forte (${o25}%).`);
  if (btts >= 60)
    bits.push(`BTTS aparece com peso real (${btts}%), reforçando a leitura de jogo aberto.`);
  if (bits.length === 0)
    bits.push(`Mercado sem distorções evidentes — entrar somente com convicção tática.`);
  const marketRead = bits.join(" ");

  // ─── 5. Opportunities ──────────────────────────────────────
  const sorted = [...markets].sort((a, b) => b.probability - a.probability).slice(0, 3);
  const opportunities: ReadingOpportunity[] = sorted.map((m) => {
    const reasons: string[] = [];
    if (m.market.includes("Over") && m.market.includes("Gols")) {
      reasons.push(`projeção combinada de ${fmt(total)} gols`);
      if (hGA >= 1.3 || aGA >= 1.3)
        reasons.push(`defesas vêm sofrendo (${fmt((hGA + aGA) / 2)} por jogo em média)`);
    }
    if (m.market === "Ambas Marcam") {
      reasons.push(`ataques somam ${fmt(hGF + aGF)} gols/jogo`);
      if (hGA >= 1.2 && aGA >= 1.2)
        reasons.push("as duas defesas dão brechas com frequência");
    }
    if (m.market.includes("Cantos") && hCorners != null && aCorners != null)
      reasons.push(`média de ${fmt(hCorners + aCorners)} escanteios por jogo`);
    if (m.market.includes("Cartões") && hCards != null && aCards != null)
      reasons.push(`${fmt(hCards + aCards)} amarelos por jogo nas duas equipes`);
    if (m.market === "Vitória Casa") {
      reasons.push(`${home} chega em melhor fase ofensiva`);
      if (oddH) reasons.push(`odd de mercado ${oddH.toFixed(2)}`);
    }
    if (m.market === "Vitória Fora") {
      reasons.push(`${away} chega em melhor fase ofensiva`);
      if (oddA) reasons.push(`odd de mercado ${oddA.toFixed(2)}`);
    }
    if (reasons.length === 0)
      reasons.push(`leitura combinada aponta ${m.probability}% de chance`);
    return { market: m.market, confidence: m.probability, reasons: reasons.slice(0, 3) };
  });

  // ─── 6. Alerts ─────────────────────────────────────────────
  const alerts: string[] = [];
  if (ctxReliab === "limitado")
    alerts.push(`Contexto externo limitado — escalações, lesões ou odds podem não estar atualizadas.`);
  if (homeN < 5 || awayN < 5)
    alerts.push(`Amostra estatística reduzida (${homeN} e ${awayN} jogos). Use a leitura como guia, não como certeza.`);
  if (homeImpact === "alto" || awayImpact === "alto")
    alerts.push(`Lesões importantes podem alterar o roteiro tático esperado.`);
  if (homeLoad >= 3 && awayLoad <= 1)
    alerts.push(`${home} pode chegar fisicamente mais desgastado — possível queda de intensidade no 2º tempo.`);
  if (awayLoad >= 3 && homeLoad <= 1)
    alerts.push(`${away} chega com calendário pesado — risco de ritmo baixo após os 60'.`);
  if (oddH && oddA && stronger && diff > 0.7 && Math.min(oddH, oddA) < 1.5)
    alerts.push(`Favoritismo extremo precificado — risco/retorno pouco atrativo na linha de resultado.`);
  if (total < 2.0)
    alerts.push(`Projeção baixa de gols (${fmt(total)}). Jogo tende a demorar a se abrir.`);
  if (alerts.length === 0)
    alerts.push(`Sem sinais de alerta — leitura limpa, dá para confiar no que os números mostram.`);

  // ─── 7. Likely scores ───────────────────────────────────────
  const likelyScores = topScores(hL, aL, 3);

  // ─── 8. Timing ──────────────────────────────────────────────
  const timing = {
    opening:
      homeSolid && awaySolid
        ? "0'–20' — início estudado, equipes se medindo"
        : "0'–20' — pode haver bola na rede cedo se alguém abrir espaços",
    pressure: total >= 2.6 ? "20'–40'" : "25'–45'",
    acceleration: stronger === away ? "55'–70'" : "60'–80'",
  };

  // ─── 9. Predictability ──────────────────────────────────────
  let pred: "verde" | "amarelo" | "vermelho" = "verde";
  if (ctxReliab === "limitado" || homeImpact === "alto" || awayImpact === "alto")
    pred = "vermelho";
  else if (ctxReliab === "parcial" || homeN < 5 || awayN < 5 || homeImpact === "médio" || awayImpact === "médio")
    pred = "amarelo";

  // ─── 10. Verdict ────────────────────────────────────────────
  let verdict = "";
  if (pred === "vermelho") {
    verdict = `Jogo perigoso para entradas pré-jogo agressivas. ${ctxReliab === "limitado" ? "Faltam dados de contexto importantes." : "Lesões pesam no roteiro esperado."} Melhor abordagem: aguardar movimentação ao vivo antes de entrar.`;
  } else if (opportunities.length > 0 && opportunities[0].confidence >= 70) {
    const top = opportunities[0];
    verdict = `${top.market} (${top.confidence}%) é a leitura mais sólida do confronto. Linhas de resultado oferecem menos valor que os mercados de gols/ambas.`;
  } else if (pred === "amarelo") {
    verdict = `Partida com leitura razoável, mas sem favoritismo claro. Operar com cautela e em mercados específicos vale mais do que apostar no resultado final.`;
  } else {
    verdict = `Cenário equilibrado e previsível. Os mercados de gols apresentam melhor relação risco/retorno do que linhas de vitória.`;
  }

  return {
    summary,
    tactical,
    indicators,
    marketRead,
    opportunities,
    alerts,
    likelyScores,
    timing,
    predictability: pred,
    verdict,
    contextQuality: ctxReliab,
  };
}
