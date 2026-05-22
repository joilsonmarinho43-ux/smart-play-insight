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
const fact = (n: number) => { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; };
const poisson = (l: number, k: number) => (Math.exp(-l) * Math.pow(l, k)) / fact(k);
const bayes = (avg: number, league: number, n: number, k = 3) =>
  n <= 0 ? league : (n * avg + k * league) / (n + k);

function topScores(hL: number, aL: number, n = 3) {
  const items: { s: string; p: number }[] = [];
  for (let h = 0; h <= 5; h++)
    for (let a = 0; a <= 5; a++)
      items.push({ s: `${h}-${a}`, p: poisson(hL, h) * poisson(aL, a) });
  items.sort((x, y) => y.p - x.p);
  return items.slice(0, n).map((i) => i.s);
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

  // λ ajustado (Bayes + força ofensiva × fragilidade adversária)
  const adjHGF = bayes(hGF, leagueAvg, homeN);
  const adjAGA = bayes(aGA, leagueAvg, awayN);
  const adjAGF = bayes(aGF, leagueAvg, awayN);
  const adjHGA = bayes(hGA, leagueAvg, homeN);
  const hL = (adjHGF / leagueAvg) * (adjAGA / leagueAvg) * leagueAvg;
  const aL = (adjAGF / leagueAvg) * (adjHGA / leagueAvg) * leagueAvg;
  const total = hL + aL;
  const diff = hL - aL;
  const balanced = Math.abs(diff) < 0.25;

  let markets: MarketAnalysis[] = [];
  try { markets = analyzeMarkets(match); } catch { markets = []; }
  if (markets.length === 0) return null;

  const o25Prob = markets.find((m) => m.market === "Over 2.5 Gols")?.probability ?? 0;
  const bttsProb = markets.find((m) => m.market === "Ambas Marcam")?.probability ?? 0;
  const u25Prob = markets.find((m) => m.market === "Under 2.5 Gols")?.probability ?? 0;

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

  // Perfis táticos
  const homeAttacks = hGF >= 1.6;
  const awayAttacks = aGF >= 1.4;
  const homeLeaks = hGA >= 1.3;
  const awayLeaks = aGA >= 1.3;
  const homeSolid = hGA <= 1.0;
  const awaySolid = aGA <= 1.0;
  const lowScoringProfile = total < 2.2 && !homeAttacks && !awayAttacks;
  const openProfile = total >= 2.8 || (homeAttacks && awayAttacks);
  const physicalProfile =
    hCards != null && aCards != null && hCards + aCards >= 5;

  // Favorito estatístico vs favorito de mercado
  const statFav = balanced ? null : diff > 0 ? "home" : "away";
  let oddFav: "home" | "away" | null = null;
  if (oddH && oddA) oddFav = oddH < oddA ? "home" : oddA < oddH ? "away" : null;
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
  indicators.push(`${home}: marca ${fmt(hGF)} e sofre ${fmt(hGA)} por jogo (últimas ${homeN}).`);
  indicators.push(`${away}: marca ${fmt(aGF)} e sofre ${fmt(aGA)} por jogo (últimas ${awayN}).`);
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
  for (const m of ranked) {
    if (m.market.includes("Handicap")) {
      if (banned.has("Handicap")) continue;
      banned.add("Handicap");
    }
    if (m.market.includes("Over") && finalMarkets.some((x) => x.market.includes("Under"))) continue;
    if (m.market.includes("Under") && finalMarkets.some((x) => x.market.includes("Over"))) continue;
    finalMarkets.push(m);
    if (finalMarkets.length >= 3) break;
  }

  // Amortecedor de confiança — evita percentuais exagerados em jogos sensíveis
  const dampen = (prob: number, marketName: string): number => {
    let cap = 85; // teto absoluto: nunca soar como certeza
    if (balanced) cap = Math.min(cap, 74);
    if (ctxReliab === "limitado") cap = Math.min(cap, 72);
    if (homeN < 5 || awayN < 5) cap = Math.min(cap, 72);
    if (marketDisagrees || injuriesOnFav) cap = Math.min(cap, 70);
    if (fatigueOnFav) cap = Math.min(cap, 75);
    if (goalsVsTacticConflict && /Gols|Ambas/i.test(marketName)) cap = Math.min(cap, 68);
    if (/Handicap/i.test(marketName) && balanced) cap = Math.min(cap, 66);
    return Math.min(prob, cap);
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
      if (hCorners != null && aCorners != null)
        reasons.push(`média combinada de ${fmt(hCorners + aCorners)} escanteios por jogo`);
      if (statFav) reasons.push(`o favorito tende a empilhar pressão ofensiva`);
    } else if (m.market.includes("Cartões") || m.market.includes("Amarelos")) {
      if (hCards != null && aCards != null)
        reasons.push(`${fmt(hCards + aCards)} amarelos por jogo nas duas equipes`);
      if (physicalProfile) reasons.push(`perfil físico esperado favorece o mercado`);
    } else if (m.market === "Vitória Casa") {
      reasons.push(`${home} chega em melhor fase ofensiva como mandante`);
      if (oddH) reasons.push(`mercado precifica em ${oddH.toFixed(2)}`);
    } else if (m.market === "Vitória Fora") {
      reasons.push(`${away} chega mais produtivo e ${home} tem fragilidades expostas`);
      if (oddA) reasons.push(`mercado precifica em ${oddA.toFixed(2)}`);
    } else {
      reasons.push(`leitura combinada aponta ${m.probability}% de chance`);
    }
    return { market: m.market, confidence: dampen(m.probability, m.market), reasons: reasons.slice(0, 3) };
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
  if (alerts.length === 0)
    alerts.push(`Sem sinais de alerta relevantes — leitura limpa, dá para confiar no que os números mostram.`);

  // ─── 7. PLACARES ────────────────────────────────────────────
  const likelyScores = topScores(hL, aL, 3);

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
  if (
    ctxReliab === "limitado" ||
    injuriesOnFav ||
    marketDisagrees ||
    goalsVsTacticConflict
  )
    pred = "vermelho";
  else if (
    ctxReliab === "parcial" ||
    homeN < 5 || awayN < 5 ||
    homeImpact === "médio" || awayImpact === "médio" ||
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
