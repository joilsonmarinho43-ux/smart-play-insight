// 🎯 Motor de Placar Exato (Deno) — Poisson bivariado com ajuste Dixon-Coles.
// Usa a mesma regressão Bayesiana-base do Nexus Core para evitar probabilidades divergentes entre runtimes.

export interface ScoreCell { home: number; away: number; prob: number; fairOdd: number }

export interface CorrectScoreRead {
  homeLambda: number;
  awayLambda: number;
  matrix: ScoreCell[];
  top: ScoreCell[];
  combo: ScoreCell[];
  comboProb: number;
  comboFairOdd: number;
  outcome: { home: number; draw: number; away: number };
  over25: number;
  under25: number;
  btts: number;
  confidence: number;
  sample: { home: number; away: number };
  label: 'ALTA' | 'MÉDIA' | 'BAIXA';
  hasRealData: boolean;
  reasons: string[];
}

const K = 3;
const MAX_GOALS = 8;
const DECAY = 0.85;

function factorial(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function poisson(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

function rhoFor(lh: number, la: number): number {
  const total = lh + la;
  if (total <= 2.0) return -0.13;
  if (total <= 2.8) return -0.09;
  if (total <= 3.5) return -0.06;
  return -0.04;
}

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

function weightedAvg(list: unknown): number | null {
  if (!Array.isArray(list) || list.length === 0) return null;
  const vals = list.map(Number).filter((n) => Number.isFinite(n) && n >= 0);
  if (!vals.length) return null;
  let w = 1, sw = 0, s = 0;
  for (const v of vals) { s += v * w; sw += w; w *= DECAY; }
  return sw > 0 ? s / sw : null;
}

export function extractLambdas(match: any) {
  const hs = match?.homeStats || {};
  const as = match?.awayStats || {};
  const md = match?.modelData || {};
  const homeN = Number(match?.sampleSize?.homeGames ?? hs.gamesCount ?? 0);
  const awayN = Number(match?.sampleSize?.awayGames ?? as.gamesCount ?? 0);
  const n = Math.min(homeN, awayN);
  const leagueRaw = Number(md.leagueAvg ?? hs.leagueAvg ?? as.leagueAvg ?? 2.5);
  const leagueAvg = Number.isFinite(leagueRaw) && leagueRaw > 0 ? leagueRaw : null;
  const hGF = Number(md.homeGoalsAvg ?? hs.goalsFor ?? NaN);
  const aGF = Number(md.awayGoalsAvg ?? as.goalsFor ?? NaN);
  const hGA = Number(md.homeGoalsAgainstAvg ?? hs.goalsAgainst ?? NaN);
  const aGA = Number(md.awayGoalsAgainstAvg ?? as.goalsAgainst ?? NaN);
  const hasRealData = n >= 3 && leagueAvg !== null && [hGF, aGF, hGA, aGA].every(Number.isFinite);
  if (!hasRealData) return { homeLambda: 0, awayLambda: 0, sample: { home: homeN, away: awayN }, hasRealData: false };
  const reg = (v: number, prior: number, games: number, strength = 3) =>
    (games * v + strength * prior) / (games + strength);
  const hAttack = reg(hGF, leagueAvg!, homeN);
  const aDefense = reg(aGA, leagueAvg!, awayN);
  const aAttack = reg(aGF, leagueAvg!, awayN);
  const hDefense = reg(hGA, leagueAvg!, homeN);
  return {
    homeLambda: Math.max(0.01, (hAttack / leagueAvg!) * (aDefense / leagueAvg!) * leagueAvg!),
    awayLambda: Math.max(0.01, (aAttack / leagueAvg!) * (hDefense / leagueAvg!) * leagueAvg!),
    sample: { home: homeN, away: awayN },
    hasRealData: true,
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

  const games = Math.min(sample.home, sample.away);
  const sampleFactor = !hasRealData ? 0 : games >= 5 ? 1 : games >= 4 ? 0.9 : games >= 3 ? 0.78 : games >= 2 ? 0.6 : 0.45;
  const totalGoals = homeLambda + awayLambda;
  const volatility = totalGoals >= 3.6 ? 0.82 : totalGoals >= 3.0 ? 0.92 : 1;
  const confidence = Math.round(Math.min(92, comboProb * 190 * sampleFactor * volatility));

  const label: CorrectScoreRead['label'] = confidence >= 58 ? 'ALTA' : confidence >= 40 ? 'MÉDIA' : 'BAIXA';

  const reasons: string[] = [];
  if (!hasRealData) reasons.push('Sem histórico real das equipes — leitura apenas indicativa.');
  else {
    reasons.push(`Amostra: ${sample.home} jogos (casa) e ${sample.away} jogos (fora).`);
    reasons.push(`Gols esperados: ${homeLambda.toFixed(2)} x ${awayLambda.toFixed(2)} (total ${totalGoals.toFixed(2)}).`);
    if (totalGoals >= 3.4) reasons.push('Jogo aberto: prefira mercados de gols.');
    if (Math.abs(homeLambda - awayLambda) < 0.25) reasons.push('Forças equilibradas: empate com peso alto.');
  }

  return {
    homeLambda, awayLambda, matrix, top, combo, comboProb, comboFairOdd,
    outcome: { home, draw, away }, over25, under25: 1 - over25, btts,
    confidence, sample, label, hasRealData, reasons,
  };
}
