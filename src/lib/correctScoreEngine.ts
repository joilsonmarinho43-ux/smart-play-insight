import { getCanonicalGoalLambdas } from '@/lib/matchAnalysis';

// 🎯 Motor de Placar Exato — Poisson bivariado com ajuste Dixon-Coles.
// Regras de integridade:
//  • Só usa números reais das equipes (modelData / homeStats / últimos jogos).
//  • Se não houver amostra real, marca `hasRealData=false` e NÃO finge precisão.
//  • Médias recentes recebem peso maior (decaimento temporal Dixon-Coles).

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
  under25: number;
  btts: number;
  confidence: number;            // 0..100
  sample: { home: number; away: number };
  label: 'ALTA' | 'MÉDIA' | 'BAIXA';
  hasRealData: boolean;          // false = sem amostra real (não apostar)
  reasons: string[];             // justificativa objetiva da leitura
}

const K = 3;                     // força da regressão bayesiana
const MAX_GOALS = 8;
const DECAY = 0.85;              // peso do jogo anterior (recência)

function factorial(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function poisson(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

/** ρ adaptativo: quanto menor o total de gols esperado, mais forte a correção de empates baixos. */
function rhoFor(lh: number, la: number): number {
  const total = lh + la;
  if (total <= 2.0) return -0.13;
  if (total <= 2.8) return -0.09;
  if (total <= 3.5) return -0.06;
  return -0.04;
}

/** Correção Dixon-Coles para placares baixos (0x0, 1x0, 0x1, 1x1). */
function dcTau(h: number, a: number, lh: number, la: number, rho: number): number {
  if (h === 0 && a === 0) return Math.max(0.05, 1 - lh * la * rho);
  if (h === 0 && a === 1) return Math.max(0.05, 1 + lh * rho);
  if (h === 1 && a === 0) return Math.max(0.05, 1 + la * rho);
  if (h === 1 && a === 1) return Math.max(0.05, 1 - rho);
  return 1;
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Média com decaimento temporal — o array vem do mais recente para o mais antigo. */
function weightedAvg(list: unknown): number | null {
  if (!Array.isArray(list) || list.length === 0) return null;
  const vals = list.map(Number).filter((n) => Number.isFinite(n) && n >= 0);
  if (!vals.length) return null;
  let w = 1, sw = 0, s = 0;
  for (const v of vals) { s += v * w; sw += w; w *= DECAY; }
  return sw > 0 ? s / sw : null;
}

/** Extrai λ de casa/fora a partir de um objeto de partida do pré-jogo. */
export function extractLambdas(match: any): {
  homeLambda: number; awayLambda: number;
  sample: { home: number; away: number };
  hasRealData: boolean;
} {
  const canonical = getCanonicalGoalLambdas(match);
  const hs = match?.homeStats || {};
  const as = match?.awayStats || {};
  const homeN = Number(match?.sampleSize?.homeGames ?? hs.gamesCount ?? 0);
  const awayN = Number(match?.sampleSize?.awayGames ?? as.gamesCount ?? 0);
  const hGF = Number(match?.modelData?.homeGoalsAvg ?? hs.goalsFor ?? NaN);
  const aGF = Number(match?.modelData?.awayGoalsAvg ?? as.goalsFor ?? NaN);
  const hasRealData = !!canonical && homeN > 0 && awayN > 0 && hGF > 0 && aGF > 0;
  if (!canonical) return { homeLambda: 0, awayLambda: 0, sample: { home: homeN, away: awayN }, hasRealData: false };
  return {
    homeLambda: canonical.homeLambda,
    awayLambda: canonical.awayLambda,
    sample: { home: homeN, away: awayN },
    hasRealData,
  };
}

export function buildCorrectScore(match: any): CorrectScoreRead {
  const { homeLambda, awayLambda, sample, hasRealData } = extractLambdas(match);
  const rho = rhoFor(homeLambda, awayLambda);

  const matrix: ScoreCell[] = [];
  let total = 0;
  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const p = poisson(h, homeLambda) * poisson(a, awayLambda) * dcTau(h, a, homeLambda, awayLambda, rho);
      matrix.push({ home: h, away: a, prob: p, fairOdd: 0 });
      total += p;
    }
  }
  // Normaliza (a truncagem em 8 gols e o τ tiram massa)
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

  // Confiança: concentração do topo × qualidade da amostra × estabilidade do jogo
  const games = Math.min(sample.home, sample.away);
  const sampleFactor = !hasRealData ? 0 : games >= 5 ? 1 : games >= 4 ? 0.9 : games >= 3 ? 0.78 : games >= 2 ? 0.6 : 0.45;
  const totalGoals = homeLambda + awayLambda;
  // Jogos muito abertos (λ total alto) são menos previsíveis em placar exato
  const volatility = totalGoals >= 3.6 ? 0.82 : totalGoals >= 3.0 ? 0.92 : 1;
  const confidence = Math.round(Math.min(92, comboProb * 190 * sampleFactor * volatility));

  const label: CorrectScoreRead['label'] =
    confidence >= 58 ? 'ALTA' : confidence >= 40 ? 'MÉDIA' : 'BAIXA';

  const reasons: string[] = [];
  if (!hasRealData) reasons.push('Sem histórico real das equipes — leitura apenas indicativa.');
  else {
    reasons.push(`Amostra: ${sample.home} jogos (casa) e ${sample.away} jogos (fora), com peso maior nos mais recentes.`);
    reasons.push(`Gols esperados: ${homeLambda.toFixed(2)} x ${awayLambda.toFixed(2)} (total ${totalGoals.toFixed(2)}).`);
    if (totalGoals >= 3.4) reasons.push('Jogo aberto: placar exato perde precisão — prefira mercados de gols.');
    if (Math.abs(homeLambda - awayLambda) < 0.25) reasons.push('Forças equilibradas: cenário de empate tem peso alto.');
  }

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
    under25: 1 - over25,
    btts,
    confidence,
    sample,
    label,
    hasRealData,
    reasons,
  };
}

export const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
