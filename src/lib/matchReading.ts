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

  // ─── Summary built from real numbers ──────────────────────────
  const diff = homeLambda - awayLambda;
  const stronger = diff > 0.25 ? home : diff < -0.25 ? away : null;
  const paceLabel =
    totalLambda >= 2.9
      ? 'alta produção ofensiva esperada'
      : totalLambda >= 2.3
      ? 'produção ofensiva moderada'
      : 'ritmo controlado e poucos espaços';
  const summary = stronger
    ? `${stronger} aparece à frente nos números (λ ${fmt(
        stronger === home ? homeLambda : awayLambda
      )} vs ${fmt(stronger === home ? awayLambda : homeLambda)}). Cenário aponta para ${paceLabel} — projeção total de ${fmt(totalLambda)} gols.`
    : `Confronto equilibrado nos modelos (λ ${fmt(homeLambda)} vs ${fmt(awayLambda)}). Cenário aponta para ${paceLabel} — projeção total de ${fmt(totalLambda)} gols.`;

  // ─── Indicators (every line backed by a number) ───────────────
  const indicators: string[] = [];
  indicators.push(
    `${home} marca ${fmt(hGF)} e sofre ${fmt(hGA)} gols/jogo em ${homeN} partidas.`
  );
  indicators.push(
    `${away} marca ${fmt(aGF)} e sofre ${fmt(aGA)} gols/jogo em ${awayN} partidas.`
  );
  indicators.push(`Média da liga: ${fmt(leagueAvg)} gols por equipe.`);
  if (totalLambda >= 2.7)
    indicators.push(`Projeção combinada elevada: ${fmt(totalLambda)} gols esperados.`);
  if (totalLambda <= 2.0)
    indicators.push(`Projeção combinada baixa: ${fmt(totalLambda)} gols esperados.`);
  if (hGA >= 1.5 || aGA >= 1.5)
    indicators.push(
      `Defesa vulnerável detectada (${home}: ${fmt(hGA)} sofridos · ${away}: ${fmt(aGA)} sofridos).`
    );
  if (hCorners != null && aCorners != null && hCorners + aCorners > 0) {
    indicators.push(
      `Média de escanteios: ${fmt(hCorners, 1)} (casa) + ${fmt(aCorners, 1)} (fora) = ${fmt(
        hCorners + aCorners,
        1
      )}/jogo.`
    );
  }
  if (hCards != null && aCards != null && hCards + aCards > 0) {
    indicators.push(
      `Média de cartões: ${fmt(hCards + aCards, 1)} amarelos por jogo somados.`
    );
  }

  // ─── Market read (driven by real probabilities) ───────────────
  const o25 = markets.find((m) => m.market === 'Over 2.5 Gols')?.probability ?? 0;
  const btts = markets.find((m) => m.market === 'Ambas Marcam')?.probability ?? 0;
  const homeWin = markets.find((m) => m.market === 'Vitória Casa')?.probability ?? 0;
  const awayWin = markets.find((m) => m.market === 'Vitória Fora')?.probability ?? 0;
  const marketBits: string[] = [];
  if (o25 >= 65)
    marketBits.push(
      `Over 2.5 com ${o25}% — projeção acima da média justifica valor na linha de gols.`
    );
  else if (o25 > 0 && o25 <= 40)
    marketBits.push(`Over 2.5 com apenas ${o25}% — linha de gols sem valor claro.`);
  else if (o25 > 0)
    marketBits.push(`Over 2.5 com ${o25}% — zona neutra, exige seletividade.`);
  if (btts >= 60) marketBits.push(`Ambas Marcam com ${btts}% reforça o cenário de jogo aberto.`);
  if (homeWin >= 55) marketBits.push(`${home} com ${homeWin}% de probabilidade na vitória direta.`);
  if (awayWin >= 55) marketBits.push(`${away} com ${awayWin}% de probabilidade fora de casa.`);
  if (marketBits.length === 0)
    marketBits.push('Mercados sem entrada de alto valor — melhor evitar exposição direta.');
  const marketRead = marketBits.join(' ');

  // ─── Top opportunities (real probabilities + real reasons) ────
  const sorted = [...markets].sort((a, b) => b.probability - a.probability).slice(0, 3);
  const opportunities: ReadingOpportunity[] = sorted.map((m) => {
    const reasons: string[] = [];
    if (m.market.includes('Over') && m.market.includes('Gols')) {
      reasons.push(`projeção total de ${fmt(totalLambda)} gols`);
      if (hGA >= 1.3 || aGA >= 1.3)
        reasons.push(`defesas sofrem em média ${fmt((hGA + aGA) / 2)} gols/jogo`);
    }
    if (m.market.includes('Cantos') && hCorners != null && aCorners != null) {
      reasons.push(`média de ${fmt(hCorners + aCorners, 1)} escanteios/jogo`);
    }
    if (m.market.includes('Cartões') && hCards != null && aCards != null) {
      reasons.push(`média de ${fmt(hCards + aCards, 1)} amarelos/jogo`);
    }
    if (m.market === 'Ambas Marcam') {
      reasons.push(`ataques somam ${fmt(hGF + aGF)} gols/jogo`);
      if (hGA >= 1.2 && aGA >= 1.2) reasons.push('vulnerabilidade defensiva mútua');
    }
    if (m.market === 'Vitória Casa')
      reasons.push(`λ ${fmt(homeLambda)} vs ${fmt(awayLambda)} a favor da casa`);
    if (m.market === 'Vitória Fora')
      reasons.push(`λ ${fmt(awayLambda)} vs ${fmt(homeLambda)} a favor do visitante`);
    if (m.market.startsWith('Handicap'))
      reasons.push(`diferença de ${fmt(Math.abs(diff))} no λ esperado`);
    if (m.market.startsWith('1X'))
      reasons.push(`casa+empate concentra a maior fatia da probabilidade`);
    if (m.market.startsWith('X2'))
      reasons.push(`visitante+empate concentra a maior fatia da probabilidade`);
    if (m.market.startsWith('Gol no 1° Tempo'))
      reasons.push(`λ HT estimado em ${fmt(totalLambda * 0.45)}`);
    if (m.market.startsWith('Gol no 2° Tempo'))
      reasons.push(`λ FT estimado em ${fmt(totalLambda * 0.55)}`);
    if (reasons.length === 0)
      reasons.push(`probabilidade de ${m.probability}% pelo modelo Poisson+xG`);
    return { market: m.market, confidence: m.probability, reasons: reasons.slice(0, 3) };
  });

  // ─── Alerts (only fire when a real signal triggers) ───────────
  const alerts: string[] = [];
  if (dqLabel !== 'completa')
    alerts.push(
      `Amostra ${dqLabel} (${homeN}/${awayN} jogos) — regressão bayesiana aplicada para suavizar incerteza.`
    );
  if (stronger && diff > 0.7)
    alerts.push(
      `${stronger} muito favorito (Δλ ${fmt(diff)}) — risco de controle de jogo após abrir vantagem.`
    );
  if (totalLambda < 2.0)
    alerts.push(`Projeção baixa (${fmt(totalLambda)}) — partida pode demorar a se abrir.`);
  if (totalLambda > 3.3)
    alerts.push(`Projeção muito alta (${fmt(totalLambda)}) — jogos abertos viram imprevisíveis.`);
  if (hGA <= 0.9 && aGA <= 0.9)
    alerts.push(
      `Duas defesas sólidas (${fmt(hGA)} e ${fmt(aGA)} sofridos) — cautela em Over.`
    );
  if (alerts.length === 0) alerts.push('Sem alertas relevantes — leitura limpa pelos números.');

  // ─── Likely scores from real Poisson distribution ─────────────
  const likelyScores = topScores(homeLambda, awayLambda, 3);

  // ─── Timing — derived from λ split ────────────────────────────
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
