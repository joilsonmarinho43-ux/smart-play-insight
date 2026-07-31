import { analyzeMarkets } from "./matchAnalysis";
import type { MatchData, MarketAnalysis } from "@/types/match";

// ─── Tipos (mantidos para compatibilidade) ────────────────────
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
    meta?: {
      bookmakers: number;
      sourceLabel: string;
      primaryBookmaker: string | null;
    };
    opening?: {
      home: number | null; draw: number | null; away: number | null;
      over25: number | null; under25: number | null;
      capturedAt?: string;
    };
    movement?: {
      home: "up" | "down" | "flat";
      draw: "up" | "down" | "flat";
      away: "up" | "down" | "flat";
      over25: "up" | "down" | "flat";
    };
  } | null;
  reliability?: "completo" | "parcial" | "limitado";
}

export interface ReadingOpportunity {
  market: string;
  confidence: number;
  reasons: string[];
  category?: string;
  /** Probabilidade bruta do modelo (antes do amortecedor de exibição). */
  modelProbability?: number;
}

export interface GoalLineSuggestion {
  line: number;              // 0.5, 1.5, 2.5, 3.5
  side: "over" | "under";
  probability: number;       // 0-100
  recommended: boolean;
  rationale: string;
}

export interface BestMarketPick {
  market: string;
  category: string;
  confidence: number;
  modelProbability?: number;    // probabilidade bruta do modelo (base da odd justa)
  fairOdd: number | null;       // odd justa estimada (1/p)
  marketOdd: number | null;     // odd real disponível, se houver
  edgePct: number | null;       // valor em % vs odd real (positivo = valor)
  risk: "baixo" | "medio" | "alto";
  rationale: string;
  alternatives: { market: string; confidence: number; category: string }[];
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
  projectedGoals: number;
  goalLines: GoalLineSuggestion[];
  trendTags: string[];
  premiumInsight: string;
  signature: string;
  bestPick: BestMarketPick | null;
}


// ─── Math ─────────────────────────────────────────────────────
const fact = (n: number) => { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; };
const poisson = (l: number, k: number) => (Math.exp(-l) * Math.pow(l, k)) / fact(k);
const bayes = (avg: number, league: number, n: number, k = 3) =>
  n <= 0 ? league : (n * avg + k * league) / (n + k);

function topScores(hL: number, aL: number, n = 3) {
  const max = Math.max(5, Math.ceil(hL + aL) + 2);
  const items: { s: string; p: number; h: number; a: number }[] = [];
  let totalMass = 0;
  for (let h = 0; h <= max; h++)
    for (let a = 0; a <= max; a++) {
      const p = poisson(hL, h) * poisson(aL, a);
      totalMass += p;
      items.push({ s: `${h}-${a}`, p, h, a });
    }
  items.sort((x, y) => y.p - x.p);
  // Diversidade: evita 3 placares com mesmo total de gols (ex.: 1-1, 1-0, 0-0 todos baixos)
  const out: typeof items = [];
  const totalsSeen = new Map<number, number>();
  for (const it of items) {
    const tot = it.h + it.a;
    const seen = totalsSeen.get(tot) ?? 0;
    if (seen >= 2) continue; // no máx. 2 placares com mesmo total
    out.push(it);
    totalsSeen.set(tot, seen + 1);
    if (out.length >= n) break;
  }
  return out.map((i) => {
    const pct = Math.round((i.p / (totalMass || 1)) * 100);
    return `${i.s} (${pct}%)`;
  });
}
const fmt = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : "—");
const pick = <T,>(arr: T[], seed: number): T => arr[Math.abs(seed) % arr.length];
const seeded = (seed: number, arr: string[][]) => arr.map((a) => pick(a, seed)).join(" ");

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

  // λ base (Bayes + força ofensiva × fragilidade adversária)
  const adjHGF = bayes(hGF, leagueAvg, homeN);
  const adjAGA = bayes(aGA, leagueAvg, awayN);
  const adjAGF = bayes(aGF, leagueAvg, awayN);
  const adjHGA = bayes(hGA, leagueAvg, homeN);
  const hL0 = (adjHGF / leagueAvg) * (adjAGA / leagueAvg) * leagueAvg;
  const aL0 = (adjAGF / leagueAvg) * (adjHGA / leagueAvg) * leagueAvg;
  const rawTotal = hL0 + aL0;

  // Contexto
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
  const oddH = ctx?.odds?.home ?? null;
  const oddD = ctx?.odds?.draw ?? null;
  const oddA = ctx?.odds?.away ?? null;
  const oddO = ctx?.odds?.over25 ?? null;

  // Perfis táticos (medidos sobre a produção bruta das equipes)
  const homeAttacks = hGF >= 1.6;
  const awayAttacks = aGF >= 1.4;
  const homeLeaks = hGA >= 1.3;
  const awayLeaks = aGA >= 1.3;
  const homeSolid = hGA <= 1.0;
  const awaySolid = aGA <= 1.0;
  const lowScoringProfile = rawTotal < 2.2 && !homeAttacks && !awayAttacks;
  const openProfile = rawTotal >= 2.8 || (homeAttacks && awayAttacks);
  const physicalProfile =
    hCards != null && aCards != null && hCards + aCards >= 5;

  let oddFav: "home" | "away" | null = null;
  if (oddH && oddA) oddFav = oddH < oddA ? "home" : oddA < oddH ? "away" : null;

  // ─── λ AJUSTADO POR CONTEXTO REAL ───────────────────────────
  // Um único λ ajustado alimenta TODA a leitura (narrativa, placares,
  // linhas de gols e oportunidades). Antes existiam dois λ diferentes
  // — texto usava o bruto e as linhas o ajustado — o que gerava
  // percentuais divergentes na mesma tela.
  let hLs = hL0;
  let aLs = aL0;
  if (homeImpact === "alto") { hLs *= 0.88; aLs *= 1.05; }
  else if (homeImpact === "médio") { hLs *= 0.95; }
  if (awayImpact === "alto") { aLs *= 0.85; hLs *= 1.06; }
  else if (awayImpact === "médio") { aLs *= 0.94; }
  const motTitle = (s: string | null) => !!s && /t[íi]tulo/i.test(s);
  const motCont  = (s: string | null) => !!s && /classifica/i.test(s);
  const motReleg = (s: string | null) => !!s && /rebaixamento/i.test(s);
  const motMid   = (s: string | null) => !!s && /meio-tabela/i.test(s);
  if (motTitle(homeMot) || motCont(homeMot)) hLs *= 1.05;
  if (motTitle(awayMot) || motCont(awayMot)) aLs *= 1.05;
  if (motReleg(homeMot)) hLs *= 0.96;
  if (motReleg(awayMot)) aLs *= 0.94;
  if (motMid(homeMot) && motMid(awayMot)) { hLs *= 0.95; aLs *= 0.95; }
  if (homeLoad >= 3 || (homeRest != null && homeRest <= 2)) hLs *= 0.93;
  if (awayLoad >= 3 || (awayRest != null && awayRest <= 2)) aLs *= 0.91;
  if (oddH && oddA) {
    if (oddFav === "home" && oddH <= 1.6) hLs *= 1.04;
    if (oddFav === "away" && oddA <= 1.7) aLs *= 1.05;
  }
  if (lowScoringProfile) { hLs *= 0.92; aLs *= 0.92; }
  if (openProfile) { hLs *= 1.04; aLs *= 1.04; }
  hLs = Math.max(0.15, Math.min(hLs, 3.8));
  aLs = Math.max(0.10, Math.min(aLs, 3.4));

  // A partir daqui, hL/aL SÃO os λ ajustados usados em toda a leitura.
  const hL = hLs;
  const aL = aLs;
  const total = hL + aL;
  const diff = hL - aL;
  const balanced = Math.abs(diff) < 0.25;

  // Favorito estatístico vs favorito de mercado
  const statFav = balanced ? null : diff > 0 ? "home" : "away";
  const marketDisagrees =
    statFav && oddFav && statFav !== oddFav;

  // Conflitos contextuais
  const fatigueOnFav =
    (statFav === "home" && (homeLoad >= 3 || (homeRest != null && homeRest <= 2))) ||
    (statFav === "away" && (awayLoad >= 3 || (awayRest != null && awayRest <= 2)));
  const injuriesOnFav =
    (statFav === "home" && homeImpact === "alto") ||
    (statFav === "away" && awayImpact === "alto");
  const goalsVsTacticConflict = total >= 2.7 && lowScoringProfile === false && (homeSolid && awaySolid);

  // ─── LINHAS DE GOLS (Poisson sobre o λ ajustado) ────────────
  const probOver = (line: number): number => {
    const threshold = Math.ceil(line); // 0.5→1, 1.5→2, 2.5→3, 3.5→4
    let cum = 0;
    for (let k = 0; k < threshold; k++) cum += poisson(total, k);
    return Math.max(0, Math.min(1, 1 - cum));
  };

  let markets: MarketAnalysis[] = [];
  try { markets = analyzeMarkets(match); } catch { markets = []; }
  if (markets.length === 0) return null;

  // Sincroniza as linhas Over/Under de gols com o λ ajustado ANTES de
  // qualquer filtro de corte. Antes, o corte de 58% usava a probabilidade
  // bruta e a exibição usava a ajustada — mercados de 45% reais apareciam
  // como "oportunidade".
  markets = markets.map((m) => {
    const mOver = m.market.match(/Over\s+(\d\.\d)\s+Gols/i);
    const mUnder = m.market.match(/Under\s+(\d\.\d)\s+Gols/i);
    if (mOver) {
      return { ...m, probability: Math.round(probOver(parseFloat(mOver[1])) * 100) };
    }
    if (mUnder) {
      return { ...m, probability: Math.round((1 - probOver(parseFloat(mUnder[1]))) * 100) };
    }
    return m;
  });

  const o25Prob = markets.find((m) => m.market === "Over 2.5 Gols")?.probability ?? 0;
  const bttsProb = markets.find((m) => m.market === "Ambas Marcam")?.probability ?? 0;
  const u25Prob = markets.find((m) => m.market === "Under 2.5 Gols")?.probability ?? Math.max(0, 100 - o25Prob);

  const seed = Math.round(hL * 100 + aL * 50 + (homeN + awayN) * 7 + (oddH || 0) * 11);



  // ─── 1. SUMMARY (narrativo, variado) ────────────────────────
  let summary = "";
  if (statFav) {
    const favName = statFav === "home" ? home : away;
    const dogName = statFav === "home" ? away : home;
    const intensity = Math.abs(diff);
    const strong = intensity >= 0.6;
    const opens = [
      `${favName} chega tecnicamente um degrau acima de ${dogName}, mas vale entender o que está por trás dos números.`,
      `Olhando o panorama, o peso do favoritismo recai sobre ${favName} — só que o cenário não é tão limpo quanto parece.`,
      `${favName} entra como referência da partida frente a ${dogName}, ainda assim a leitura pede atenção em detalhes que o mercado costuma ignorar.`,
      strong
        ? `${favName} se apresenta claramente superior nos indicadores recentes, mas favoritismo extremo costuma cobrar valor — é aí que mora o cuidado.`
        : `${favName} aparece um pouco à frente de ${dogName}, em um confronto que tem mais nuances do que o placar do papel sugere.`,
    ];
    summary = pick(opens, seed);

    const ctxMods: string[] = [];
    if (injuriesOnFav)
      ctxMods.push(
        `A perda de jogadores importantes pesa justamente no lado mais forte do confronto e reduz parte do favoritismo esperado.`,
      );
    else if ((statFav === "home" ? homeImpact : awayImpact) === "médio")
      ctxMods.push(
        `Algumas ausências relevantes do lado favorito podem custar ritmo na criação, mesmo sem mudar o roteiro geral.`,
      );
    if (fatigueOnFav)
      ctxMods.push(
        `O calendário pesado das últimas semanas tende a cobrar fisicamente o favorito, principalmente após o intervalo.`,
      );
    if (marketDisagrees)
      ctxMods.push(
        `Mais um ponto: o mercado precifica o oposto do que os números mostram, sinal clássico de linha turbinada pelo nome.`,
      );
    summary += " " + ctxMods.join(" ");
  } else {
    summary = pick(
      [
        `${home} e ${away} chegam em condições muito parecidas. Não há favorito claro — quem decide a partida são os detalhes.`,
        `Confronto bem nivelado entre ${home} e ${away}, daqueles em que pequenos lances mudam a leitura completa do jogo.`,
        `Não dá para apontar um favorito convincente entre ${home} e ${away}. O equilíbrio é real e o pré-jogo reflete isso.`,
      ],
      seed,
    );
  }

  // Fechamento do resumo com ritmo esperado
  const rhythm = openProfile
    ? `Expectativa de jogo de ritmo aberto, com cerca de ${fmt(total)} gols projetados.`
    : lowScoringProfile
    ? `O cenário aponta para uma partida truncada, com defesas se sobrepondo e por volta de ${fmt(total)} gols na soma.`
    : `Ritmo equilibrado esperado, com projeção de ${fmt(total)} gols na conta final.`;
  summary += " " + rhythm;

  // ─── 2. TÁTICA (multi-frase: posse + transição + comportamento + ritmo) ──
  const tacticalParts: string[] = [];

  // 2a. Quem controla / quem reage
  if (homeAttacks && awayLeaks && !awayAttacks) {
    tacticalParts.push(
      pick([
        `${home} tende a controlar mais a posse em casa e empurrar ${away} para trás cedo.`,
        `Em casa, ${home} costuma puxar o jogo para o campo adversário e impor pressão posicional sobre ${away}.`,
      ], seed),
    );
    tacticalParts.push(`${away} deve responder com bloco médio-baixo, tentando sair em transição rápida quando recuperar a bola.`);
  } else if (awayAttacks && homeLeaks && !homeSolid) {
    tacticalParts.push(`${away} chega ofensivamente mais afiado e tem condições reais de tomar a iniciativa, mesmo fora.`);
    tacticalParts.push(`${home} dá espaços entre linhas — é justamente onde ${away} costuma machucar, em jogadas verticais.`);
  } else if (homeSolid && awaySolid) {
    tacticalParts.push(`Dois blocos defensivos bem organizados. A leitura é de jogo posicional, disputado no meio-campo, com poucos espaços naturais.`);
    tacticalParts.push(pick([
      `Gols, se vierem, devem nascer de bola parada ou erro individual.`,
      `O placar deve ser decidido em detalhe — uma jogada ensaiada, um lance isolado.`,
    ], seed));
  } else if (homeAttacks && awayAttacks) {
    tacticalParts.push(`Os dois gostam de jogar para frente. A tendência é de linhas adiantadas e troca constante de iniciativa.`);
    tacticalParts.push(`Espaços nas costas das laterais devem aparecer dos dois lados — jogo de ida e volta é o cenário mais provável.`);
  } else if (balanced && physicalProfile) {
    tacticalParts.push(`Início estudado, físico, com muita disputa no meio. Os times não devem se expor antes dos 25 minutos.`);
    tacticalParts.push(`Os espaços tendem a aparecer só quando a intensidade cair — geralmente na transição para o segundo tempo.`);
  } else if (statFav === "home") {
    tacticalParts.push(`${home} deve ditar o ritmo em casa, com posse mais elaborada e construção pelos lados.`);
    tacticalParts.push(`${away} provavelmente recua bloco e aposta em jogadas pontuais, sem se entregar no campo de ataque.`);
  } else if (statFav === "away") {
    tacticalParts.push(`${away} chega em melhor fase ofensiva e pode comandar boa parte das ações mesmo fora.`);
    tacticalParts.push(`${home} tende a estudar a partida antes de se lançar — primeiro tempo de poucos riscos é provável.`);
  } else {
    tacticalParts.push(`Cenário tático equilibrado: os dois costumam medir o adversário antes de se expor.`);
    tacticalParts.push(`O jogo deve abrir mesmo só a partir da segunda etapa, quando o cansaço diluir o cuidado.`);
  }

  // 2b. Ritmo do 1º vs 2º tempo + pressão lateral
  if (openProfile) {
    tacticalParts.push(pick([
      `Ritmo deve ser intenso desde cedo — equipes não costumam segurar a bola.`,
      `Linhas adiantadas e troca rápida de iniciativa devem marcar a primeira etapa.`,
    ], seed));
  } else if (lowScoringProfile) {
    tacticalParts.push(`Primeiro tempo tende a ser de poucas finalizações claras; a partida costuma se abrir só após o intervalo, quando o cansaço diluir o cuidado tático.`);
  } else {
    tacticalParts.push(`Início mais estudado é o esperado, com aceleração ofensiva real depois dos 25 minutos e segunda etapa naturalmente mais aberta.`);
  }

  // 2c. Pressão pelos lados / bola parada
  if (hCorners != null && aCorners != null && hCorners + aCorners >= 10) {
    tacticalParts.push(`A pressão pelos lados é uma marca dos dois — boa parte das chances claras tende a nascer de cruzamento ou segunda bola após escanteio.`);
  } else if (homeAttacks && !awayAttacks) {
    tacticalParts.push(`${home} deve concentrar a pressão pelos corredores em casa, enquanto ${away} tenta neutralizar pelo meio.`);
  }

  // 2d. Leitura emocional do confronto
  const emotional: string[] = [];
  if (homeMot === "luta contra rebaixamento" || awayMot === "luta contra rebaixamento") {
    emotional.push(`A tensão competitiva é real — quem luta por sobrevivência costuma entregar mais raça do que técnica, e isso pesa no roteiro.`);
  } else if (homeMot === "disputa por título" || awayMot === "disputa por título") {
    emotional.push(`Há peso emocional pelo lado que briga lá em cima — pressão por resultado pode pesar mais do que ajudar.`);
  } else if (balanced && physicalProfile) {
    emotional.push(`A tendência é de um confronto mais estratégico do que acelerado, com controle psicológico contando tanto quanto o repertório técnico.`);
  } else if (statFav && Math.abs(diff) >= 0.6) {
    emotional.push(`Se o favorito abrir o placar cedo, costuma administrar e baixar a intensidade. Se sofrer primeiro, o jogo ganha cara emocional na segunda etapa.`);
  } else if (balanced) {
    emotional.push(`O jogo deve oscilar emocionalmente — paciência conta mais do que pressão constante.`);
  }
  if (emotional.length) tacticalParts.push(emotional[0]);

  // 2e. Esquemas se disponíveis
  if (ctx?.lineups?.home?.formation && ctx?.lineups?.away?.formation) {
    tacticalParts.push(`Esquema provável: ${home} ${ctx.lineups.home.formation} × ${ctx.lineups.away.formation} ${away}.`);
  }

  const tactical = tacticalParts.join(" ");

  // ─── 3. INDICADORES (apenas os relevantes) ──────────────────
  const indicators: string[] = [];
  const fmtGames = (n: number) =>
    n === 1 ? "último 1 jogo" : `últimos ${n} jogos`;
  indicators.push(`${home}: marca ${fmt(hGF)} e sofre ${fmt(hGA)} por jogo (${fmtGames(homeN)}).`);
  indicators.push(`${away}: marca ${fmt(aGF)} e sofre ${fmt(aGA)} por jogo (${fmtGames(awayN)}).`);
  if (openProfile)
    indicators.push(`Projeção combinada elevada — ${fmt(total)} gols esperados na soma.`);
  if (lowScoringProfile)
    indicators.push(`Projeção baixa de gols (${fmt(total)}). Jogo tende a demorar a se abrir.`);
  if (homeLeaks && awayLeaks)
    indicators.push(`Defesas vazando dos dois lados — cenário favorável a jogo aberto.`);
  if (hCorners != null && aCorners != null && hCorners + aCorners >= 10)
    indicators.push(`Boa média combinada de escanteios: ${fmt(hCorners + aCorners)} por jogo.`);
  if (physicalProfile)
    indicators.push(`Tendência de jogo físico — ${fmt((hCards ?? 0) + (aCards ?? 0))} amarelos somados em média.`);
  if (homeImpact === "alto") indicators.push(`Desfalques pesados no ${home} mexem com a estrutura titular.`);
  if (awayImpact === "alto") indicators.push(`${away} chega com baixas importantes que afetam o setor principal.`);
  if (homeMot === "luta contra rebaixamento")
    indicators.push(`${home} luta contra o rebaixamento — entrega física máxima é praticamente garantida.`);
  if (awayMot === "luta contra rebaixamento")
    indicators.push(`${away} luta contra o rebaixamento — tende a se entregar mesmo jogando fora.`);
  if (homeMot === "disputa por título" && homeRank)
    indicators.push(`${home} é ${homeRank}º e briga pelo título — pressão por resultado pesa no roteiro.`);
  if (awayMot === "disputa por título" && awayRank)
    indicators.push(`${away} (${awayRank}º) entra pressionado pela ponta da tabela.`);
  if (homeRest != null && homeRest <= 2)
    indicators.push(`${home} jogou há apenas ${homeRest} dia(s) — desgaste pode aparecer no 2º tempo.`);
  if (awayRest != null && awayRest <= 2)
    indicators.push(`${away} chega com pouca recuperação (${awayRest}d desde o último jogo).`);

  // ─── 4. LEITURA DE MERCADO (interpretação, não números) ─────
  const bits: string[] = [];

  // Movimento real de odds (steam / drift)
  const mv = ctx?.odds?.movement;
  const op = ctx?.odds?.opening;
  if (mv && op) {
    if (mv.home === "down" && op.home && oddH)
      bits.push(`📉 ${home} teve a odd recuada de ${op.home.toFixed(2)} para ${oddH.toFixed(2)} — mercado aumentou a confiança no mandante.`);
    else if (mv.away === "down" && op.away && oddA)
      bits.push(`📉 Visitante caiu de ${op.away.toFixed(2)} para ${oddA.toFixed(2)} — sinal de dinheiro entrando em ${away}.`);
    else if (mv.home === "up" && op.home && oddH)
      bits.push(`📈 ${home} subiu de ${op.home.toFixed(2)} para ${oddH.toFixed(2)} — mercado esfriou em relação ao mandante.`);
    else if (mv.away === "up" && op.away && oddA)
      bits.push(`📈 Odd visitante abriu em ${op.away.toFixed(2)} e está em ${oddA.toFixed(2)} — confiança recuou nas últimas horas.`);
    if (mv.over25 === "down" && op.over25 && oddO)
      bits.push(`📉 Linha de Over 2.5 recuou (${op.over25.toFixed(2)} → ${oddO.toFixed(2)}) — mercado ajustou a expectativa para mais gols.`);
    else if (mv.over25 === "up" && op.over25 && oddO)
      bits.push(`📈 Over 2.5 subiu de ${op.over25.toFixed(2)} para ${oddO.toFixed(2)} — perfil de jogo travado ganhou força.`);
  }

  if (oddH && oddA) {
    if (marketDisagrees) {
      const mFav = oddFav === "home" ? home : away;
      const sFav = statFav === "home" ? home : away;
      bits.push(
        pick([
          `O mercado respeita o peso de ${mFav} (${(oddFav === "home" ? oddH : oddA).toFixed(2)}), mas os números recentes de ${sFav} contam outra história. Linha provavelmente turbinada pelo nome.`,
          `Mercado precifica ${mFav} como referência, só que o cenário estatístico desenha favoritismo do outro lado. Sinal clássico de armadilha pré-jogo.`,
        ], seed),
      );
    } else if (statFav) {
      const sFav = statFav === "home" ? home : away;
      const sOdd = (statFav === "home" ? oddH : oddA).toFixed(2);
      const minOdd = Math.min(oddH, oddA);
      if (minOdd < 1.45) {
        bits.push(`Favoritismo de ${sFav} (${sOdd}) já está totalmente precificado. O mercado parece mais confiante do que os números sustentam.`);
      } else if (minOdd < 1.7) {
        bits.push(`Mercado reconhece ${sFav} como favorito (${sOdd}), em linha com o que os indicadores apontam — sem distorção evidente, mas também sem prêmio.`);
      } else {
        bits.push(`Favoritismo existe a favor de ${sFav} (${sOdd}). Controle absoluto, não — a margem é mais magra do que o nome sugere.`);
      }
    } else {
      bits.push(
        pick([
          `Odds equilibradas (${oddH.toFixed(2)} × ${oddD ? oddD.toFixed(2) : "—"} × ${oddA.toFixed(2)}) — o mercado também não enxerga favorito claro.`,
          `Linhas espelham o que os números mostram: confronto sem favorito convincente, decidido em detalhe.`,
        ], seed),
      );
    }
  }

  if (oddO && o25Prob) {
    const implied = (1 / oddO) * 100;
    if (o25Prob - implied >= 8)
      bits.push(`Linha de Over 2.5 (${oddO.toFixed(2)}) parece subdimensionada frente à projeção real (${o25Prob}%) — há valor disponível.`);
    else if (implied - o25Prob >= 8)
      bits.push(`Over 2.5 está caro para o cenário: ${o25Prob}% projetado contra ${implied.toFixed(0)}% implícita no preço. Linha inflada.`);
    else
      bits.push(`Linha de gols parece relativamente ajustada — pouca margem para entradas agressivas.`);
  } else if (lowScoringProfile && o25Prob < 50) {
    bits.push(`O perfil do jogo aponta Under com mais consistência do que Over — quem está olhando linha de gols alta precisa redobrar a atenção.`);
  }

  // Frase de fechamento contextual do mercado
  if (balanced && oddH && oddA && Math.min(oddH, oddA) >= 1.9) {
    bits.push(`Cenário pouco confortável para handicaps agressivos — o equilíbrio reduz margem em qualquer linha exposta.`);
  } else if (statFav && oddFav === statFav && oddH && oddA && Math.min(oddH, oddA) < 1.45) {
    bits.push(`Risco/retorno pouco atrativo na linha de vencedor. O valor real está nos mercados específicos do jogo, não no resultado.`);
  }
  if (bits.length === 0)
    bits.push(`Mercado sem distorções claras — não há entrada óbvia apenas olhando preço. A leitura tem que vir do cenário.`);

  const marketRead = bits.join(" ");

  // ─── 5. OPORTUNIDADES (coerentes, máx 3, sem contradição) ──
  const banned = new Set<string>();
  const conf2Side = (m: MarketAnalysis) => {
    if (m.market === "Vitória Casa" && statFav === "away") return true;
    if (m.market === "Vitória Fora" && statFav === "home") return true;
    if (m.market.includes("Over 2.5") && lowScoringProfile) return true;
    if (m.market.includes("Under 2.5") && openProfile) return true;
    if (m.market === "Ambas Marcam" && (homeSolid && awaySolid)) return true;
    if (m.market.includes("Handicap")) {
      // evita recomendar handicap dos dois lados
      if (banned.has("Handicap")) return true;
    }
    return false;
  };

  // Bloqueia mercados rasos/genéricos que não soam como leitura profissional
  const shallowMarket = (name: string) =>
    /Over 0\.5/i.test(name) ||
    /Over 1\.5 Gols/i.test(name) ||
    /Under 4\.5/i.test(name) ||
    /Under 5\.5/i.test(name);

  const ranked = [...markets]
    .filter((m) => m.probability >= 58)
    .filter((m) => !conf2Side(m))
    .filter((m) => !shallowMarket(m.market))
    .sort((a, b) => b.probability - a.probability);

  const finalMarkets: MarketAnalysis[] = [];
  const catCount = new Map<string, number>();
  for (const m of ranked) {
    const cat = (m as any).category || "outro";
    if ((catCount.get(cat) || 0) >= 2) continue; // máx 2 por categoria
    if (m.market.includes("Handicap")) {
      if (banned.has("Handicap")) continue;
      banned.add("Handicap");
    }
    if (m.market.includes("Over") && finalMarkets.some((x) => x.market.includes("Under"))) continue;
    if (m.market.includes("Under") && finalMarkets.some((x) => x.market.includes("Over"))) continue;
    finalMarkets.push(m);
    catCount.set(cat, (catCount.get(cat) || 0) + 1);
    if (finalMarkets.length >= 5) break;
  }


  // Amortecedor de confiança — evita percentuais exagerados em jogos sensíveis.
  // Em vez de CORTAR tudo no teto (o que fazia 5 mercados diferentes exibirem
  // exatamente 72%, escondendo qual era realmente o mais forte), a compressão é
  // suave: acima do teto o excedente é comprimido de forma monotônica numa
  // faixa de 5 pontos, preservando a ordem real do modelo.
  const dampen = (prob: number, marketName: string): number => {
    let cap = 85; // teto absoluto: nunca soar como certeza
    if (balanced) cap = Math.min(cap, 74);
    if (ctxReliab === "limitado") cap = Math.min(cap, 72);
    if (homeN < 5 || awayN < 5) cap = Math.min(cap, 72);
    if (marketDisagrees || injuriesOnFav) cap = Math.min(cap, 70);
    if (fatigueOnFav) cap = Math.min(cap, 75);
    if (goalsVsTacticConflict && /Gols|Ambas/i.test(marketName)) cap = Math.min(cap, 68);
    if (/Handicap/i.test(marketName) && balanced) cap = Math.min(cap, 66);
    if (prob <= cap) return Math.round(prob);
    const excess = prob - cap;
    const compressed = cap - 5 + 5 * (1 - Math.exp(-excess / 12));
    return Math.round(Math.min(cap, compressed));
  };


  const opportunities: ReadingOpportunity[] = finalMarkets.map((m) => {
    const reasons: string[] = [];
    if (m.market.includes("Over") && m.market.includes("Gols")) {
      reasons.push(`projeção combinada de ${fmt(total)} gols`);
      if (homeLeaks || awayLeaks)
        reasons.push(`defesas vêm sofrendo (${fmt((hGA + aGA) / 2)} por jogo em média)`);
      if (homeAttacks && awayAttacks) reasons.push(`os dois ataques chegam produtivos`);
    } else if (m.market.includes("Under") && m.market.includes("Gols")) {
      reasons.push(`perfil tático truncado, com defesas se sobrepondo`);
      if (homeSolid && awaySolid) reasons.push(`as duas equipes vêm sólidas defensivamente`);
    } else if (m.market === "Ambas Marcam") {
      reasons.push(`ataques somam ${fmt(hGF + aGF)} gols/jogo`);
      if (homeLeaks && awayLeaks) reasons.push(`as duas defesas dão brechas com frequência`);
    } else if (m.market.includes("Cantos") || m.market.includes("Escanteios")) {
      const tot = (hCorners ?? 0) + (aCorners ?? 0);
      if (tot > 0) reasons.push(`média combinada de ${fmt(tot)} escanteios nos últimos jogos`);
      if (hCorners != null && aCorners != null && tot >= 10)
        reasons.push(`pressão lateral consistente nos dois lados — boa parte das chances nasce de cruzamento`);
      else if (balanced && openProfile)
        reasons.push(`equilíbrio e ritmo aberto favorecem volume de bola parada ofensiva`);
      else if (statFav && Math.abs(diff) < 0.8)
        reasons.push(`favorito empilha posse no campo de ataque sem dominar o placar`);
    } else if (m.market.includes("Cartões") || m.market.includes("Amarelos")) {
      const totC = (hCards ?? 0) + (aCards ?? 0);
      if (totC > 0) reasons.push(`${fmt(totC)} amarelos por jogo somando as duas equipes`);
      if (physicalProfile && balanced)
        reasons.push(`confronto com características físicas acima da média e disputa parelha`);
      else if (physicalProfile)
        reasons.push(`perfil disciplinar agressivo das equipes sustenta a leitura`);
      if (homeMot === "luta contra rebaixamento" || awayMot === "luta contra rebaixamento")
        reasons.push(`tensão competitiva eleva o nível de faltas táticas`);
    } else if (m.market === "Vitória Casa") {
      reasons.push(`${home} chega em melhor fase ofensiva como mandante`);
      if (oddH) reasons.push(`mercado precifica em ${oddH.toFixed(2)}`);
    } else if (m.market === "Vitória Fora") {
      reasons.push(`${away} chega mais produtivo e ${home} tem fragilidades expostas`);
      if (oddA) reasons.push(`mercado precifica em ${oddA.toFixed(2)}`);
    } else if (/^1X\b|Casa ou Empate/i.test(m.market)) {
      // Dupla chance casa+empate — favorita o mandante e protege empate
      if (statFav === "home")
        reasons.push(`${home} é favorito estatístico — derrota como mandante é o cenário menos provável`);
      else if (balanced)
        reasons.push(`jogo equilibrado em casa: ${home} raramente perde sem reagir`);
      else
        reasons.push(`${home} não vem dando espaço fácil em casa, mesmo sem ser favorito`);
      if (oddH && oddD) {
        const fairOdd = 1 / (1 / oddH + 1 / oddD);
        reasons.push(`odd justa estimada ${fairOdd.toFixed(2)} (1 ${oddH.toFixed(2)} / X ${oddD.toFixed(2)})`);
      } else if (oddA && oddA >= 2.4) {
        reasons.push(`visitante precificado em ${oddA.toFixed(2)} — vitória dele exige cenário ideal`);
      }
    } else if (/^X2\b|Empate ou Fora/i.test(m.market)) {
      // Dupla chance empate+visitante — protege azarão competente
      if (statFav === "away")
        reasons.push(`${away} chega com vantagem estatística — perde dificilmente em jogo equilibrado`);
      else if (balanced)
        reasons.push(`equilíbrio dos dois lados — empate ou reação visitante é cenário plausível`);
      else
        reasons.push(`${away} costuma escapar do revés mesmo fora de casa`);
      if (oddA && oddD) {
        const fairOdd = 1 / (1 / oddA + 1 / oddD);
        reasons.push(`odd justa estimada ${fairOdd.toFixed(2)} (X ${oddD.toFixed(2)} / 2 ${oddA.toFixed(2)})`);
      } else if (oddH && oddH >= 2.4) {
        reasons.push(`mandante precificado em ${oddH.toFixed(2)} — vitória dele não é tranquila`);
      }
    } else if (/^12\b|Casa ou Fora/i.test(m.market)) {
      reasons.push(`as duas equipes chegam buscando o resultado — perfil de jogo aberto reduz peso do empate`);
      if (oddH && oddA) reasons.push(`mercado abre as duas pontas (${oddH.toFixed(2)} × ${oddA.toFixed(2)})`);
    } else if (/Handicap/i.test(m.market)) {
      // Handicap — explica o lado e a linha
      const isPlus = /\+/.test(m.market);
      const isMinus = /-/.test(m.market) && !isPlus;
      const isFora = /Fora|Visitante/i.test(m.market);
      const isCasa = /Casa|Mandante/i.test(m.market);
      if (isPlus && isFora) {
        reasons.push(`linha protege ${away} contra derrota por margem larga`);
        if (Math.abs(diff) < 0.6) reasons.push(`diferença técnica curta — equilíbrio joga a favor do +`);
        else if (oddA && oddA >= 2.2) reasons.push(`mercado precifica visitante em ${oddA.toFixed(2)} — competitivo`);
      } else if (isPlus && isCasa) {
        reasons.push(`linha protege ${home} contra derrota acentuada em casa`);
        if (oddH) reasons.push(`mandante precificado em ${oddH.toFixed(2)}`);
      } else if (isMinus && isCasa) {
        reasons.push(`${home} chega forte como mandante — projeção sustenta vitória com folga`);
        if (oddH) reasons.push(`vitória reta precificada em ${oddH.toFixed(2)}`);
      } else if (isMinus && isFora) {
        reasons.push(`${away} chega superior tecnicamente — projeção sustenta vitória com folga`);
        if (oddA) reasons.push(`vitória reta precificada em ${oddA.toFixed(2)}`);
      } else {
        reasons.push(`linha de handicap coerente com o cenário projetado`);
      }
    } else if (/DNB|Empate Anula/i.test(m.market)) {
      const side = /Fora|Visitante/i.test(m.market) ? away : home;
      reasons.push(`${side} sustenta o lado sem risco de empate: derrota é o cenário menos provável da projeção`);
      if (Math.abs(diff) >= 0.4)
        reasons.push(`diferença de projeção de ${fmt(Math.abs(diff))} gol por jogo entre os dois lados`);
    } else if (/1°\s*Tempo|1º\s*Tempo|HT/i.test(m.market)) {
      reasons.push(`projeção de ${fmt(total * 0.42)} gols só no primeiro tempo pelo ritmo das duas equipes`);
      if (physicalProfile) reasons.push(`início costuma ser estudado — linha curta é a leitura correta aqui`);
    } else if (/2°\s*Tempo|2º\s*Tempo/i.test(m.market)) {
      reasons.push(`projeção de ${fmt(total * 0.58)} gols na etapa final, onde o jogo historicamente se abre`);
      if (!lowScoringProfile) reasons.push(`desgaste e mudanças de banco elevam o volume após os 60'`);
    } else if (m.market === "Empate") {
      reasons.push(`equilíbrio de projeção (${fmt(hL)} × ${fmt(aL)}) mantém o empate vivo até o fim`);
    } else {
      reasons.push(`modelo Poisson + forma recente projeta ${fmt(hL)} × ${fmt(aL)} e sustenta este mercado`);
    }

    // Garante que nenhum mercado saia sem justificativa numérica real
    // (ex.: cantos/cartões sem média capturada caíam em texto genérico).
    if (reasons.length === 0) {
      reasons.push(
        `projeção Poisson ${fmt(hL)} × ${fmt(aL)} (${fmt(total)} gols) sobre ${homeN}+${awayN} jogos de amostra sustenta ${m.probability}% neste mercado`,
      );
    }

    return {
      market: m.market,
      confidence: dampen(m.probability, m.market),
      modelProbability: m.probability,
      reasons: reasons.slice(0, 3),
      category: (m as any).category || "outro",
    };
  });




  // ─── 6. ALERTAS (inteligentes, não genéricos) ───────────────
  const alerts: string[] = [];
  if (ctxReliab === "limitado")
    alerts.push(`Contexto externo limitado — escalações, lesões ou odds podem não estar atualizadas.`);
  if (homeN < 5 || awayN < 5)
    alerts.push(`Amostra estatística reduzida (${homeN} e ${awayN} jogos). Use a leitura como guia, não como certeza.`);
  if (injuriesOnFav)
    alerts.push(`Lesões importantes pegam justamente o lado favorito — favoritismo precisa ser visto com desconto.`);
  if (marketDisagrees)
    alerts.push(`Mercado pode estar reagindo ao nome do time, não ao desempenho recente — atenção a armadilha.`);
  if (goalsVsTacticConflict)
    alerts.push(`Conflito de sinais: números apontam gols, mas o perfil tático sugere jogo mais lento.`);
  if (fatigueOnFav)
    alerts.push(`Favorito chega com calendário pesado — risco de queda de intensidade na segunda etapa.`);
  if (oddH && oddA && statFav && Math.min(oddH, oddA) < 1.45)
    alerts.push(`Favoritismo extremo precificado — pouco valor na linha simples de vencedor.`);
  if (physicalProfile && balanced)
    alerts.push(`Tendência de início estudado e jogo físico — bola na rede cedo é menos provável; cuidado com linhas agressivas de HT.`);
  if (statFav && Math.abs(diff) >= 0.5 && (oddH && oddA && Math.min(oddH, oddA) >= 1.7))
    alerts.push(`Favorito pode reduzir intensidade após abrir vantagem — atenção em mercados de ritmo.`);
  if (balanced && (oddH && oddA && Math.min(oddH, oddA) >= 2.1))
    alerts.push(`Cenário perigoso para handicaps agressivos — o equilíbrio cobra qualquer entrada exposta.`);
  if (lowScoringProfile && o25Prob >= 50)
    alerts.push(`Perfil tático truncado conflita com Over 2.5 alto — confiar no contexto, não só no número.`);
  if (homeImpact === "alto" && awayImpact === "alto")
    alerts.push(`Os dois lados chegam desfalcados — a leitura pré-jogo perde precisão e pede confirmação ao vivo.`);
  const hasCornerOp = opportunities.some((o) => /Cantos|Escanteios/i.test(o.market));
  const hasCardOp = opportunities.some((o) => /Cart[õo]es|Amarelos/i.test(o.market));
  if (!hasCornerOp && hCorners != null && aCorners != null)
    alerts.push(`Sem valor estatístico relevante para escanteios pré-jogo — cenário não sustenta entrada.`);
  if (!hasCardOp && hCards != null && aCards != null)
    alerts.push(`Mercado disciplinar sem valor estatístico relevante — contexto frio para cartões.`);
  if (alerts.length === 0)
    alerts.push(`Sem sinais de alerta relevantes — leitura limpa, dá para confiar no que os números mostram.`);

  // ─── 7. PLACARES (sobre o λ já ajustado por contexto real) ──
  const likelyScores = topScores(hL, aL, 3);

  // ─── 7b. LINHAS DE GOLS (Over/Under realista por Poisson) ───
  const totalAdj = total;



  const linesRaw = [0.5, 1.5, 2.5, 3.5].map((line) => {
    const pOver = probOver(line) * 100;
    const pUnder = 100 - pOver;
    const side: "over" | "under" = pOver >= pUnder ? "over" : "under";
    const probability = Math.round(Math.max(pOver, pUnder));
    return { line, side, probability };
  });

  // Sugestão recomendada: maior valor realista
  // - prioriza Over com maior linha que ainda tenha prob ≥ 72%
  // - se nenhuma Over alcança, escolhe Under com prob ≥ 72% na menor linha
  // - fallback: maior probabilidade entre todas
  let recIdx = -1;
  for (let i = linesRaw.length - 1; i >= 0; i--) {
    const l = linesRaw[i];
    if (l.side === "over" && l.probability >= 72) { recIdx = i; break; }
  }
  if (recIdx === -1) {
    for (let i = 0; i < linesRaw.length; i++) {
      const l = linesRaw[i];
      if (l.side === "under" && l.probability >= 72) { recIdx = i; break; }
    }
  }
  if (recIdx === -1) {
    recIdx = linesRaw.reduce((best, l, i, arr) => l.probability > arr[best].probability ? i : best, 0);
  }

  const rationaleFor = (l: { line: number; side: "over" | "under"; probability: number }): string => {
    if (l.side === "over") {
      if (l.line <= 0.5) return `É raríssimo o jogo terminar 0-0 com a projeção atual (${fmt(totalAdj)} gols esperados).`;
      if (l.line <= 1.5) return `Pelo menos 2 gols se sustentam bem na projeção combinada (${fmt(totalAdj)}).`;
      if (l.line <= 2.5) return openProfile
        ? `Perfil ofensivo dos dois lados sustenta a linha com folga.`
        : `Projeção total (${fmt(totalAdj)}) cobre a linha com margem.`;
      return `Cenário aberto o suficiente para passar dos 3 gols — entrada agressiva, mas amparada.`;
    }
    if (l.line >= 3.5) return `Improvável o jogo passar de 3 gols dado o perfil das equipes.`;
    if (l.line >= 2.5) return lowScoringProfile
      ? `Perfil truncado e defesas firmes pesam contra a linha de 2.5.`
      : `Projeção (${fmt(totalAdj)}) não sustenta consistentemente Over 2.5.`;
    if (l.line >= 1.5) return `Jogo tende a ficar abaixo de 2 gols — defesas se sobrepõem ao ataque.`;
    return `Cenário extremo de jogo zerado — só aparece em partidas muito travadas.`;
  };

  const goalLines: GoalLineSuggestion[] = linesRaw.map((l, i) => ({
    line: l.line,
    side: l.side,
    probability: l.probability,
    recommended: i === recIdx,
    rationale: rationaleFor(l),
  }));

  // Ordenação final: as linhas de gols já foram sincronizadas com o λ
  // ajustado ANTES do corte de qualidade, então aqui só ordenamos.
  // Percentuais iguais são permitidos (o valor exibido é o valor real do
  // modelo); o desempate usa a probabilidade bruta, nunca um número
  // inventado para "parecer" diferente.
  opportunities.sort(
    (a, b) =>
      b.confidence - a.confidence ||
      (b.modelProbability ?? 0) - (a.modelProbability ?? 0),
  );




  // ─── 8. TIMING (perfil tático real) ─────────────────────────
  const timing = {
    opening:
      homeSolid && awaySolid
        ? `0'–20' — início estudado, equipes se medindo no meio-campo`
        : physicalProfile
        ? `0'–20' — disputa física e poucos espaços, gol cedo é exceção`
        : openProfile
        ? `0'–20' — pode haver bola na rede cedo se alguém abrir espaços`
        : `0'–20' — ritmo controlado, com aproximações sem grande pressão`,
    pressure:
      openProfile ? `25'–40' (jogo já aberto)` :
      lowScoringProfile ? `35'–55' (após o ritmo se acomodar)` :
      `25'–45'`,
    acceleration:
      fatigueOnFav ? `55'–70' (favorito pode cair de produção depois)` :
      statFav === "away" ? `55'–70'` :
      lowScoringProfile ? `70'–85' (geralmente o jogo só abre na reta final)` :
      `60'–80'`,
  };

  // ─── 9. PREDICTABILIDADE ────────────────────────────────────
  let pred: "verde" | "amarelo" | "vermelho" = "verde";
  // Só marca "vermelho" quando há conflito real de leitura — não apenas por contexto limitado
  if (
    (injuriesOnFav && marketDisagrees) ||
    (marketDisagrees && goalsVsTacticConflict) ||
    (ctxReliab === "limitado" && marketDisagrees)
  )
    pred = "vermelho";
  else if (
    ctxReliab === "limitado" ||
    ctxReliab === "parcial" ||
    homeN < 5 || awayN < 5 ||
    homeImpact === "médio" || awayImpact === "médio" ||
    injuriesOnFav ||
    marketDisagrees ||
    goalsVsTacticConflict ||
    fatigueOnFav
  )
    pred = "amarelo";

  // ─── 10. VEREDITO (decisão, voz de analista) ────────────────
  let verdict = "";
  const topOp = opportunities[0];
  const goalsMarket = opportunities.find((o) => o.market.includes("Gols") || o.market === "Ambas Marcam");

  if (pred === "vermelho" && marketDisagrees) {
    verdict = pick([
      `O favoritismo de mercado não se sustenta nos números — cenário típico de armadilha. A leitura segura é ficar fora do vencedor e olhar mercados alternativos${goalsMarket ? `, com destaque para ${goalsMarket.market.toLowerCase()}` : ""}.`,
      `O mercado parece mais confiante do que o desempenho recente justifica. É o tipo de jogo em que respeitar a dúvida vale mais do que insistir na linha óbvia.`,
    ], seed);
  } else if (pred === "vermelho" && injuriesOnFav) {
    verdict = `Lesões importantes desestabilizam justamente o lado favorito. Cenário pede paciência: melhor confirmar comportamento ao vivo do que arriscar pré-jogo exposto.`;
  } else if (pred === "vermelho" && goalsVsTacticConflict) {
    verdict = `Números e perfil tático brigam entre si — não há leitura segura para gols agressivos. Mercados conservadores ou específicos oferecem leitura melhor do que linhas amplas.`;
  } else if (topOp && topOp.confidence >= 72) {
    verdict = `${topOp.market} (${topOp.confidence}%) aparece como a leitura mais sólida do confronto. ${
      goalsMarket && goalsMarket !== topOp
        ? `Os mercados conservadores de gols oferecem leitura mais segura do que linhas agressivas de vencedor.`
        : `O valor está aí — linhas de resultado simples entregam menos do que esse mercado específico.`
    }`;
  } else if (balanced) {
    verdict = pick([
      `Partida equilibrada e com baixa margem para entradas pré-jogo muito expostas. ${
        goalsMarket
          ? `O mercado de ${goalsMarket.market.toLowerCase()} é o que oferece leitura mais segura.`
          : `Sem distorções claras — só entrar com convicção tática real.`
      } Favoritismo existe? Em pequena dose. Domínio absoluto? Não.`,
      `É o tipo de jogo decidido em detalhe. ${
        goalsMarket
          ? `Linhas conservadoras de gols se sustentam melhor que qualquer entrada no vencedor.`
          : `Melhor recuar a exposição e aguardar leitura ao vivo do que forçar entrada agora.`
      }`,
    ], seed);
  } else if (pred === "amarelo") {
    verdict = `Leitura razoável, mas sem favoritismo dominante. ${
      topOp
        ? `Vale priorizar ${topOp.market.toLowerCase()} e fugir de mercados de vencedor com odd curta.`
        : `Sem entrada com convicção plena — aguardar movimentação do mercado é o mais sensato.`
    }`;
  } else {
    verdict = `Cenário previsível e coerente. ${
      topOp
        ? `${topOp.market} oferece a melhor relação risco/retorno do pré-jogo. Os mercados específicos têm mais valor que as linhas de vencedor.`
        : `Os mercados conservadores de gols entregam leitura mais segura do que linhas agressivas de resultado.`
    }`;
  }

  // Assinatura humana — fecha o veredito com voz de analista
  const signatures = [
    `Favoritismo existe. Controle absoluto, não.`,
    `É mais jogo de paciência do que intensidade.`,
    `O mercado parece mais confortável com o favorito do que os números.`,
    `Jogo decidido em detalhe costuma punir entradas agressivas.`,
    `A odd chama atenção. O contexto nem tanto.`,
    `Leitura fria pesa mais aqui do que torcida pelo nome.`,
    `Nesses jogos, recuar exposição é jogada de analista, não de torcedor.`,
  ];
  // Só adiciona assinatura se ainda não houver uma frase muito parecida no verdict
  if (!/Favoritismo existe|paciência|punir entradas|recuar exposição/i.test(verdict)) {
    verdict += ` ${pick(signatures, seed + 3)}`;
  }

  // ─── 11. TRENDS + PREMIUM INSIGHT ───────────────────────────
  const trendTags: string[] = [];
  if (openProfile) trendTags.push("jogo aberto");
  if (lowScoringProfile) trendTags.push("truncado");
  if (physicalProfile) trendTags.push("físico");
  if (homeAttacks && awayAttacks) trendTags.push("ofensivo");
  if (homeSolid && awaySolid) trendTags.push("posicional");
  if (statFav && Math.abs(diff) >= 0.5) trendTags.push("reativo do azarão");
  if (hCorners != null && aCorners != null && hCorners + aCorners >= 10)
    trendTags.push("pressão alta");
  if (!openProfile && !lowScoringProfile) trendTags.push("crescimento no 2° tempo");
  if (balanced && !physicalProfile) trendTags.push("equilibrado");
  if (trendTags.length === 0) trendTags.push("ritmo médio");

  const insightPool: string[] = [];
  if (hCorners != null && aCorners != null && hCorners + aCorners >= 9)
    insightPool.push("O mercado de cantos apresenta mais estabilidade estatística do que a linha de resultado.");
  if (!openProfile && !lowScoringProfile)
    insightPool.push("A intensidade ofensiva tende a crescer de forma consistente depois dos 60 minutos.");
  if (balanced)
    insightPool.push("A projeção favorece a dinâmica do jogo, não o domínio absoluto de um dos lados.");
  if (statFav && Math.abs(diff) >= 0.6 && oddH && oddA && Math.min(oddH, oddA) < 1.55)
    insightPool.push("Favoritismo está integralmente precificado — o valor migra para mercados de comportamento, não de vencedor.");
  if (homeLeaks && awayLeaks)
    insightPool.push("Com as duas defesas vulneráveis, mercados de ambas marcam costumam responder melhor que linhas de gols totais.");
  if (lowScoringProfile)
    insightPool.push("Perfil truncado eleva o peso de bola parada e de erros pontuais sobre o resultado final.");
  if (marketDisagrees)
    insightPool.push("Quando o mercado vai contra os números, leitura de valor exige paciência tática maior do que o normal.");
  if (insightPool.length === 0)
    insightPool.push("A leitura sustenta entradas seletivas em mercados de dinâmica, e desaconselha exposição em linhas amplas.");
  const premiumInsight = pick(insightPool, seed + 7);

  // ─── 12. MELHOR MERCADO (value-based, diversificado) ─────────
  // Critério de "valor" não é só probabilidade: também olha edge vs odd real
  // quando disponível, penaliza mercados rasos, e bonifica mercados específicos
  // (cantos, cartões, dupla chance, handicap) quando atingem confiança suficiente,
  // evitando que o "melhor pick" seja sempre a mesma linha de gols.
  const oddByMarket = (name: string): number | null => {
    const o = ctx?.odds;
    if (!o) return null;
    if (name === "Vitória Casa") return o.home ?? null;
    if (name === "Vitória Fora") return o.away ?? null;
    if (name === "Empate") return o.draw ?? null;
    if (/Over 2\.5/i.test(name)) return o.over25 ?? null;
    if (/Under 2\.5/i.test(name)) return o.under25 ?? null;
    if (/Ambas Marcam/i.test(name)) return o.bttsYes ?? null;
    return null;
  };

  // Suporte de dados por categoria: um mercado só ganha peso extra quando
  // existe amostra REAL por trás dele. Antes havia bônus fixo (cantos +3,
  // handicap +4...) mesmo sem média capturada — isso é achismo e podia
  // eleger como "melhor entrada" um mercado sem base estatística.
  const sampleTotal = homeN + awayN;
  const cornerDataOk = hCorners != null && aCorners != null && hCorners + aCorners > 0 && sampleTotal >= 6;
  const cardDataOk = hCards != null && aCards != null && hCards + aCards > 0 && sampleTotal >= 6;
  const goalDataOk = sampleTotal >= 6;
  const dataSupport = (cat: string): number => {
    if (cat === "corners") return cornerDataOk ? 3 : -12;
    if (cat === "cards") return cardDataOk ? 3 : -12;
    if (cat === "handicap") return goalDataOk ? 2 : -8;
    if (cat === "chance_dupla") return goalDataOk ? 1 : -4;
    if (cat === "htft") return goalDataOk ? 0 : -6;
    return goalDataOk ? 0 : -4;
  };
  const riskOf = (conf: number): "baixo" | "medio" | "alto" =>
    conf >= 78 ? "baixo" : conf >= 68 ? "medio" : "alto";

  let bestPick: BestMarketPick | null = null;
  if (opportunities.length > 0) {
    const scored = opportunities.map((op) => {
      const cat = op.category || "outro";
      // Odd justa vem da probabilidade REAL do modelo (não da confiança exibida,
      // que é amortecida): usar a confiança inflava artificialmente o edge.
      const p = op.modelProbability ?? op.confidence;
      const fairOdd = p > 0 ? Number((100 / p).toFixed(2)) : null;
      const marketOdd = oddByMarket(op.market);
      let edgePct: number | null = null;
      if (marketOdd && fairOdd) {
        edgePct = Number((((marketOdd / fairOdd) - 1) * 100).toFixed(1));
      }
      // score = confiança + suporte de dados real; soma edge quando favorável.
      let score = op.confidence + dataSupport(cat);
      if (edgePct != null && edgePct > 0) score += Math.min(15, edgePct);
      if (edgePct != null && edgePct < -5) score -= 8; // sem valor real
      // penaliza Empate isolado e amostra curta
      if (op.market === "Empate") score -= 6;
      if (ctxReliab === "limitado") score -= 2;
      if (homeN < 3 || awayN < 3) score -= 6;
      return { op, score, fairOdd, marketOdd, edgePct, cat };
    });
    scored.sort((a, b) => b.score - a.score);

    const top = scored[0];
    // Alternativas: sem repetir a mesma categoria do pick principal nem entre si
    // (evita "Over 5.5 Cantos" + "Over 7.5 Cantos" ou 1X + DNB Casa lado a lado).
    const usedCats = new Set<string>([top.cat]);
    const alternatives = scored
      .slice(1)
      .filter((s) => {
        if (usedCats.has(s.cat)) return false;
        usedCats.add(s.cat);
        return true;
      })
      .slice(0, 3)
      .map((s) => ({ market: s.op.market, confidence: s.op.confidence, category: s.cat }));

    const edgeNote = top.edgePct != null
      ? top.edgePct > 3
        ? ` Odd de mercado em ${top.marketOdd?.toFixed(2)} contra justa ${top.fairOdd?.toFixed(2)} — valor de +${top.edgePct.toFixed(1)}%.`
        : top.edgePct < -3
          ? ` Odd de mercado (${top.marketOdd?.toFixed(2)}) abaixo da justa (${top.fairOdd?.toFixed(2)}) — entrada sem valor agregado, prefira live.`
          : ` Odd alinhada ao valor justo (${top.marketOdd?.toFixed(2)} vs ${top.fairOdd?.toFixed(2)}).`
      : top.fairOdd
        ? ` Odd justa estimada ${top.fairOdd.toFixed(2)} (sem cotação capturada para comparar).`
        : "";
    bestPick = {
      market: top.op.market,
      category: top.cat,
      confidence: top.op.confidence,
      modelProbability: top.op.modelProbability ?? top.op.confidence,
      fairOdd: top.fairOdd,
      marketOdd: top.marketOdd,
      edgePct: top.edgePct,
      risk: riskOf(top.op.confidence),
      rationale: `${top.op.reasons[0] || "Cenário sustenta o mercado."}${edgeNote}`,
      alternatives,
    };
  }

  // Cola o melhor mercado no veredito — voz clara de analista, sem ficar preso a um único mercado.
  if (bestPick) {
    const valueTag =
      bestPick.edgePct != null && bestPick.edgePct >= 4
        ? ` com valor real de +${bestPick.edgePct.toFixed(1)}% sobre a odd publicada`
        : bestPick.edgePct != null && bestPick.edgePct <= -4
          ? ` (sem valor agregado contra a odd atual — observar live)`
          : "";
    const altTxt =
      bestPick.alternatives.length > 0
        ? ` Alternativas válidas: ${bestPick.alternatives.map((a) => `${a.market} ${a.confidence}%`).join(" · ")}.`
        : "";
    verdict += ` 🎯 Melhor entrada mapeada: ${bestPick.market} (${bestPick.confidence}%)${valueTag}.${altTxt}`;
  }



  return {

    projectedGoals: Number((hLs + aLs).toFixed(1)),
    goalLines,
    trendTags,
    premiumInsight,
    signature: "— Nexus 33",
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
    bestPick,
  };

}
