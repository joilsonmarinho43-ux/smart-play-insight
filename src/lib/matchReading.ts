import { analyzeMarkets } from './matchAnalysis';
import type { MatchData, MarketAnalysis } from '@/types/match';

export interface ReadingOpportunity {
  market: string;
  confidence: number;
  reasons: string[];
}

export interface MatchReading {
  summary: string;
  indicators: string[];
  marketRead: string;
  opportunities: ReadingOpportunity[];
  alerts: string[];
  likelyScores: string[];
  timing: { pressure: string; acceleration: string };
  dataQuality: {
    homeGames: number;
    awayGames: number;
    label: 'completa' | 'parcial' | 'limitada';
  };
}

// ─── Math helpers ───────────────────────────────────────────────
function factorial(n: number): number {
  if (n <= 1) return 1;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}
function poisson(lambda: number, k: number): number {
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
}
function bayesianLambda(teamAvg: number, leagueAvg: number, n: number, k = 3): number {
  if (n <= 0) return leagueAvg;
  return (n * teamAvg + k * leagueAvg) / (n + k);
}
function topScores(homeLambda: number, awayLambda: number, n = 3): string[] {
  const items: { h: number; a: number; p: number }[] = [];
  for (let h = 0; h <= 5; h++)
    for (let a = 0; a <= 5; a++)
      items.push({ h, a, p: poisson(homeLambda, h) * poisson(awayLambda, a) });
  items.sort((x, y) => y.p - x.p);
  return items.slice(0, n).map((s) => `${s.h}-${s.a}`);
}
function fmt(n: number, d = 2): string {
  return Number.isFinite(n) ? n.toFixed(d) : '—';
}

/**
 * Generates a REAL match reading based exclusively on observed statistics.
 * Returns null when data is insufficient — no generic placeholders.
 */
export function buildMatchReading(match: MatchData): MatchReading | null {
  const home = match.homeTeam || 'Mandante';
  const away = match.awayTeam || 'Visitante';

  // ─── Pull real stats ──────────────────────────────────────────
  const hGF = match.modelData?.homeGoalsAvg ?? (match as any).homeStats?.goalsFor ?? null;
  const aGF = match.modelData?.awayGoalsAvg ?? (match as any).awayStats?.goalsFor ?? null;
  const hGA = match.modelData?.homeGoalsAgainstAvg ?? (match as any).homeStats?.goalsAgainst ?? null;
  const aGA = match.modelData?.awayGoalsAgainstAvg ?? (match as any).awayStats?.goalsAgainst ?? null;
  const hCorners = match.modelData?.homeCornersAvg ?? (match as any).homeStats?.corners ?? null;
  const aCorners = match.modelData?.awayCornersAvg ?? (match as any).awayStats?.corners ?? null;
  const hCards = match.modelData?.homeCardsAvg ?? (match as any).homeStats?.yellowCards ?? null;
  const aCards = match.modelData?.awayCardsAvg ?? (match as any).awayStats?.yellowCards ?? null;
  const homeN = match.sampleSize?.homeGames ?? (match as any).homeStats?.gamesCount ?? 0;
  const awayN = match.sampleSize?.awayGames ?? (match as any).awayStats?.gamesCount ?? 0;
  const leagueAvg =
    (match as any).homeStats?.leagueAvg ?? (match as any).awayStats?.leagueAvg ?? 1.3;

  // Without offensive averages we cannot build a real reading.
  if (hGF == null || aGF == null || hGA == null || aGA == null) return null;
  if (homeN <= 0 && awayN <= 0) return null;

  // Bayesian regression to league mean — same engine as analyzeMarkets
  const adjHGF = bayesianLambda(hGF, leagueAvg, homeN);
  const adjAGA = bayesianLambda(aGA, leagueAvg, awayN);
  const adjAGF = bayesianLambda(aGF, leagueAvg, awayN);
  const adjHGA = bayesianLambda(hGA, leagueAvg, homeN);

  const homeLambda =
    adjHGF > 0 && adjAGA > 0
      ? (adjHGF / leagueAvg) * (adjAGA / leagueAvg) * leagueAvg
      : adjHGF;
  const awayLambda =
    adjAGF > 0 && adjHGA > 0
      ? (adjAGF / leagueAvg) * (adjHGA / leagueAvg) * leagueAvg
      : adjAGF;
  const totalLambda = homeLambda + awayLambda;

  // Real market probabilities (Poisson + xG cross-validation)
  let markets: MarketAnalysis[] = [];
  try {
    markets = analyzeMarkets(match);
  } catch {
    markets = [];
  }
  if (markets.length === 0) return null;

  // ─── Data quality ─────────────────────────────────────────────
  const minSample = Math.min(homeN || 0, awayN || 0);
  const dqLabel: 'completa' | 'parcial' | 'limitada' =
    minSample >= 5 ? 'completa' : minSample >= 3 ? 'parcial' : 'limitada';

  // ─── Summary (linguagem natural, sem jargão) ──────────────────
  const diff = homeLambda - awayLambda;
  const stronger = diff > 0.25 ? home : diff < -0.25 ? away : null;
  const weaker = stronger === home ? away : stronger === away ? home : null;
  const pace =
    totalLambda >= 2.9
      ? 'um jogo movimentado, com chances dos dois lados'
      : totalLambda >= 2.3
      ? 'um jogo equilibrado em ritmo, com chances pontuais'
      : 'um jogo travado, com poucos espaços e bola disputada no meio';

  const summary = stronger
    ? `Olhando friamente para os números, o ${stronger} chega em vantagem sobre o ${weaker}. ` +
      `A expectativa é de ${pace}, com algo em torno de ${fmt(totalLambda, 1)} gols na soma final. ` +
      `Nada que feche a partida, mas o favoritismo está claramente de um lado.`
    : `É um confronto bem nivelado, sem favorito evidente entre ${home} e ${away}. ` +
      `O cenário aponta para ${pace}, com cerca de ${fmt(totalLambda, 1)} gols esperados no total. ` +
      `Tudo indica que pequenos detalhes vão decidir.`;

  // ─── Indicadores em linguagem de torcedor/analista ────────────
  const indicators: string[] = [];
  indicators.push(
    `O ${home} vem marcando ${fmt(hGF, 1)} e sofrendo ${fmt(hGA, 1)} gols por jogo (últimas ${homeN} partidas).`
  );
  indicators.push(
    `O ${away} marca ${fmt(aGF, 1)} e leva ${fmt(aGA, 1)} por jogo (últimas ${awayN} partidas).`
  );
  if (totalLambda >= 2.7)
    indicators.push(`Quando juntamos os dois ataques, o jogo tende a ter bastante gol — esperado ${fmt(totalLambda, 1)} no total.`);
  if (totalLambda <= 2.0)
    indicators.push(`A soma dos ataques sugere um jogo amarrado — projeção total de apenas ${fmt(totalLambda, 1)} gols.`);
  if (hGA >= 1.5 && aGA >= 1.5)
    indicators.push(`As duas defesas vêm vazando bastante — isso costuma abrir o jogo.`);
  else if (hGA >= 1.5)
    indicators.push(`A defesa do ${home} tem falhado em casa (${fmt(hGA, 1)} sofridos por jogo).`);
  else if (aGA >= 1.5)
    indicators.push(`A defesa do ${away} tem dado espaços fora (${fmt(aGA, 1)} sofridos por jogo).`);
  if (hCorners != null && aCorners != null && hCorners + aCorners > 0) {
    const tot = hCorners + aCorners;
    const tag = tot >= 10 ? ' — jogo de muita pressão lateral' : tot <= 7 ? ' — jogo mais central' : '';
    indicators.push(`A média de escanteios soma cerca de ${fmt(tot, 1)} por partida${tag}.`);
  }
  if (hCards != null && aCards != null && hCards + aCards > 0) {
    const tot = hCards + aCards;
    const tag = tot >= 5 ? ' — partida costuma esquentar' : tot <= 3 ? ' — jogo mais limpo' : '';
    indicators.push(`Em cartões, a média gira em ${fmt(tot, 1)} amarelos por jogo${tag}.`);
  }

  // ─── Leitura de mercado em linguagem direta ───────────────────
  const o25 = markets.find((m) => m.market === 'Over 2.5 Gols')?.probability ?? 0;
  const btts = markets.find((m) => m.market === 'Ambas Marcam')?.probability ?? 0;
  const homeWin = markets.find((m) => m.market === 'Vitória Casa')?.probability ?? 0;
  const awayWin = markets.find((m) => m.market === 'Vitória Fora')?.probability ?? 0;
  const marketBits: string[] = [];
  if (o25 >= 65) marketBits.push(`A linha de gols tem valor real — o Over 2.5 sai em ${o25}% e está acima do que o mercado costuma pagar.`);
  else if (o25 > 0 && o25 <= 40) marketBits.push(`A linha de gols não convence (${o25}% no Over 2.5) — mais sentido pensar em Under.`);
  else if (o25 > 0) marketBits.push(`A linha de gols está em zona neutra (${o25}% no Over 2.5) — entrar só com convicção.`);
  if (btts >= 60) marketBits.push(`Ambas Marcam aparece forte (${btts}%) e reforça a leitura de jogo aberto.`);
  if (homeWin >= 55) marketBits.push(`O ${home} é favorito real para vencer (${homeWin}%).`);
  if (awayWin >= 55) marketBits.push(`O ${away} entra como favorito fora de casa (${awayWin}%).`);
  if (marketBits.length === 0) marketBits.push('Não há um mercado óbvio com valor — em jogos assim, melhor ficar de fora ou esperar a partida começar.');
  const marketRead = marketBits.join(' ');

  // ─── Oportunidades com razões humanas ─────────────────────────
  const sorted = [...markets].sort((a, b) => b.probability - a.probability).slice(0, 3);
  const opportunities: ReadingOpportunity[] = sorted.map((m) => {
    const reasons: string[] = [];
    if (m.market.includes('Over') && m.market.includes('Gols')) {
      reasons.push(`projeção combinada de ${fmt(totalLambda, 1)} gols na partida`);
      if (hGA >= 1.3 || aGA >= 1.3) reasons.push(`as duas defesas vêm sofrendo em média ${fmt((hGA + aGA) / 2, 1)} por jogo`);
    }
    if (m.market.includes('Cantos') && hCorners != null && aCorners != null) {
      reasons.push(`média de ${fmt(hCorners + aCorners, 1)} escanteios por jogo somando os dois`);
    }
    if (m.market.includes('Cartões') && hCards != null && aCards != null) {
      reasons.push(`em média ${fmt(hCards + aCards, 1)} amarelos por jogo nas duas equipes`);
    }
    if (m.market === 'Ambas Marcam') {
      reasons.push(`os ataques somados marcam ${fmt(hGF + aGF, 1)} gols por jogo`);
      if (hGA >= 1.2 && aGA >= 1.2) reasons.push('os dois sistemas defensivos têm dado brechas');
    }
    if (m.market === 'Vitória Casa') reasons.push(`${home} chega em melhor fase ofensiva no confronto direto`);
    if (m.market === 'Vitória Fora') reasons.push(`${away} chega em melhor fase ofensiva no confronto direto`);
    if (m.market.startsWith('Handicap')) reasons.push(`favoritismo claro de um lado nos números recentes`);
    if (m.market.startsWith('1X')) reasons.push(`casa+empate cobre o cenário mais provável`);
    if (m.market.startsWith('X2')) reasons.push(`visitante+empate cobre o cenário mais provável`);
    if (m.market.startsWith('Gol no 1° Tempo')) reasons.push(`primeiro tempo costuma sair com bola na rede no perfil das equipes`);
    if (m.market.startsWith('Gol no 2° Tempo')) reasons.push(`segundo tempo concentra a maior parte dos gols nessas equipes`);
    if (reasons.length === 0) reasons.push(`leitura combinada dos números aponta para ${m.probability}% de chance`);
    return { market: m.market, confidence: m.probability, reasons: reasons.slice(0, 3) };
  });

  // ─── Alertas em linguagem natural ─────────────────────────────
  const alerts: string[] = [];
  if (dqLabel !== 'completa')
    alerts.push(`Atenção: a amostra ainda é ${dqLabel} (${homeN} e ${awayN} jogos). Os números servem de guia, mas pedem cautela.`);
  if (stronger && diff > 0.7)
    alerts.push(`${stronger} entra como favoritão. Se abrir o placar cedo, costuma administrar — cuidado com Over no segundo tempo.`);
  if (totalLambda < 2.0)
    alerts.push(`Projeção baixa de gols (${fmt(totalLambda, 1)}). É o tipo de jogo que demora a se abrir.`);
  if (totalLambda > 3.3)
    alerts.push(`Projeção muito alta (${fmt(totalLambda, 1)} gols). Jogos abertos viram imprevisíveis — entradas curtas e seletivas.`);
  if (hGA <= 0.9 && aGA <= 0.9)
    alerts.push(`As duas defesas estão muito sólidas. Forçar Over aqui é risco grande.`);
  if (alerts.length === 0) alerts.push('Nenhum sinal de alerta — leitura limpa, dá para confiar no que os números mostram.');

  // ─── Placares prováveis ───────────────────────────────────────
  const likelyScores = topScores(homeLambda, awayLambda, 3);

  // ─── Timing ───────────────────────────────────────────────────
  const timing = {
    pressure: totalLambda >= 2.6 ? "20'–40'" : "25'–45'",
    acceleration: stronger === away ? "55'–70'" : "60'–80'",
  };

  return {
    summary,
    indicators,
    marketRead,
    opportunities,
    alerts,
    likelyScores,
    timing,
    dataQuality: { homeGames: homeN, awayGames: awayN, label: dqLabel },
  };
}
