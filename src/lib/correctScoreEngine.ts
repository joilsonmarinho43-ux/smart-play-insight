// 🎯 Motor de Placar Exato — Poisson bivariado com ajuste Dixon-Coles.
// Usa somente médias reais das equipes (modelData / homeStats) + regressão bayesiana.

export interface ScoreCell {
  home: number;
  away: number;
  prob: number;      // 0..1
  fairOdd: number;   // 1/prob
}

export interface CorrectScoreRead {
  homeLambda: number;
  awayLambda: number;
  matrix: ScoreCell[];
  top: ScoreCell[];              // top 5 placares
  combo: ScoreCell[];            // 3 placares sugeridos (cobertura)
  comboProb: number;             // prob. somada da combinação
  comboFairOdd: number;          // odd mínima para lucro cobrindo os 3
  outcome: { home: number; draw: number; away: number };
  over25: number;
  btts: number;
  confidence: number;            // 0..100
  sample: { home: number; away: number };
  label: 'ALTA' | 'MÉDIA' | 'BAIXA';
}

const K = 3;                     // força da regressão bayesiana
const RHO = -0.05;               // ajuste Dixon-Coles (empates baixos)
const MAX_GOALS = 6;

function factorial(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function poisson(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

/** Correção Dixon-Coles para placares baixos (0x0, 1x0, 0x1, 1x1). */
function dcTau(h: number, a: number, lh: number, la: number): number {
  if (h === 0 && a === 0) return 1 - lh * la * RHO;
  if (h === 0 && a === 1) return 1 + lh * RHO;
  if (h === 1 && a === 0) return 1 + la * RHO;
  if (h === 1 && a === 1) return 1 - RHO;
  return 1;
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Extrai λ de casa/fora a partir de um objeto de partida do pré-jogo. */
export function extractLambdas(match: any): { homeLambda: number; awayLambda: number; sample: { home: number; away: number } } {
  const hs = match?.homeStats || {};
  const as = match?.awayStats || {};
  const md = match?.modelData || {};

  const leagueAvg = num(hs.leagueAvg ?? as.leagueAvg, 1.3);
  const hGF = num(md.homeGoalsAvg ?? hs.goalsFor);
  const aGF = num(md.awayGoalsAvg ?? as.goalsFor);
  const hGA = num(md.homeGoalsAgainstAvg ?? hs.goalsAgainst);
  const aGA = num(md.awayGoalsAgainstAvg ?? as.goalsAgainst);

  const homeN = num(match?.sampleSize?.homeGames ?? hs.gamesCount);
  const awayN = num(match?.sampleSize?.awayGames ?? as.gamesCount);

  const reg = (v: number, n: number) => (n > 0 ? (n * v + K * leagueAvg) / (n + K) : leagueAvg);
  const adjHGF = reg(hGF || leagueAvg, homeN);
  const adjAGF = reg(aGF || leagueAvg, awayN);
  const adjHGA = reg(hGA || leagueAvg, homeN);
  const adjAGA = reg(aGA || leagueAvg, awayN);

  // Força de ataque × fraqueza defensiva do adversário + leve vantagem de mando
  const HOME_ADV = 1.08;
  let homeLambda = (adjHGF / leagueAvg) * (adjAGA / leagueAvg) * leagueAvg * HOME_ADV;
  let awayLambda = (adjAGF / leagueAvg) * (adjHGA / leagueAvg) * leagueAvg;

  homeLambda = Math.min(4, Math.max(0.25, homeLambda));
  awayLambda = Math.min(4, Math.max(0.2, awayLambda));

  return { homeLambda, awayLambda, sample: { home: homeN, away: awayN } };
}

export function buildCorrectScore(match: any): CorrectScoreRead {
  const { homeLambda, awayLambda, sample } = extractLambdas(match);

  const matrix: ScoreCell[] = [];
  let total = 0;
  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const p = poisson(h, homeLambda) * poisson(a, awayLambda) * dcTau(h, a, homeLambda, awayLambda);
      matrix.push({ home: h, away: a, prob: p, fairOdd: 0 });
      total += p;
    }
  }
  // Normaliza (a truncagem em 6 gols e o τ tiram massa)
  matrix.forEach((c) => {
    c.prob = total > 0 ? c.prob / total : 0;
    c.fairOdd = c.prob > 0 ? 1 / c.prob : 999;
  });

  const sorted = [...matrix].sort((x, y) => y.prob - x.prob);
  const top = sorted.slice(0, 5);
  const combo = sorted.slice(0, 3);
  const comboProb = combo.reduce((s, c) => s + c.prob, 0);
  const comboFairOdd = comboProb > 0 ? 1 / comboProb : 999;

  let home = 0, draw = 0, away = 0, over25 = 0, btts = 0;
  matrix.forEach((c) => {
    if (c.home > c.away) home += c.prob;
    else if (c.home === c.away) draw += c.prob;
    else away += c.prob;
    if (c.home + c.away >= 3) over25 += c.prob;
    if (c.home > 0 && c.away > 0) btts += c.prob;
  });

  // Confiança: concentração do topo + amostra disponível
  const games = Math.min(sample.home, sample.away);
  const sampleFactor = games >= 5 ? 1 : games >= 3 ? 0.85 : games >= 1 ? 0.65 : 0.4;
  const concentration = comboProb; // ~0.20 a 0.45 tipicamente
  const confidence = Math.round(Math.min(95, concentration * 190 * sampleFactor));

  const label: CorrectScoreRead['label'] =
    confidence >= 60 ? 'ALTA' : confidence >= 42 ? 'MÉDIA' : 'BAIXA';

  return {
    homeLambda,
    awayLambda,
    matrix,
    top,
    combo,
    comboProb,
    comboFairOdd,
    outcome: { home, draw, away },
    over25,
    btts,
    confidence,
    sample,
    label,
  };
}

export const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
