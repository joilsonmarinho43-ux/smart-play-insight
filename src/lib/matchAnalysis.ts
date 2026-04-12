import { MatchData, MarketAnalysis } from '@/types/match';

/**
 * Análise REAL de mercados — Poisson + xG cross-validation
 * Weighted Average dos últimos 5 jogos + APM gate
 * COM: Regressão à média bayesiana, liga dinâmica, isValidBet filter
 */

function poissonProb(lambda: number, k: number): number {
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
}

function poissonOver(lambda: number, k: number): number {
  let cumulative = 0;
  for (let i = 0; i < k; i++) {
    cumulative += poissonProb(lambda, i);
  }
  return Math.max(0, Math.min(1, 1 - cumulative));
}

function factorial(n: number): number {
  if (n <= 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

function scoreProbability(homeLambda: number, awayLambda: number, hGoals: number, aGoals: number): number {
  return poissonProb(homeLambda, hGoals) * poissonProb(awayLambda, aGoals);
}

function calculateCombinedAPM(match: MatchData): number {
  const hDA = (match as any).homeStats?.dangerousAttacks || 0;
  const aDA = (match as any).awayStats?.dangerousAttacks || 0;
  const hShots = (match as any).homeStats?.totalShots || 0;
  const aShots = (match as any).awayStats?.totalShots || 0;
  const hSoG = (match as any).homeStats?.shotsOnGoal || 0;
  const aSoG = (match as any).awayStats?.shotsOnGoal || 0;

  if (hDA > 0 || aDA > 0) {
    return (hDA + aDA) / 90;
  }

  const proxyAttacks = (hShots + aShots) * 1.5 + (hSoG + aSoG) * 2;
  return proxyAttacks / 90;
}

function getExpectedGoals(match: MatchData): { homeXG: number; awayXG: number } {
  const hXG = (match as any).homeStats?.bigChances || (match as any).homeStats?.expectedGoals || 0;
  const aXG = (match as any).awayStats?.bigChances || (match as any).awayStats?.expectedGoals || 0;

  if (hXG > 0 || aXG > 0) {
    return { homeXG: hXG, awayXG: aXG };
  }

  // Corrected xG proxy: 0.22 instead of 0.32
  const hSoG = (match as any).homeStats?.shotsOnGoal || 0;
  const aSoG = (match as any).awayStats?.shotsOnGoal || 0;
  return {
    homeXG: hSoG * 0.22,
    awayXG: aSoG * 0.22,
  };
}

function crossValidateWithXG(poissonProbVal: number, totalXG: number, market: string): number {
  if (totalXG <= 0) return poissonProbVal;

  let xgProb = 0;

  if (market.includes('Over 0.5')) {
    xgProb = Math.min(99, (1 - Math.exp(-totalXG)) * 100);
  } else if (market.includes('Over 1.5')) {
    let cum = 0;
    for (let i = 0; i < 2; i++) cum += (Math.exp(-totalXG) * Math.pow(totalXG, i)) / factorial(i);
    xgProb = Math.min(99, (1 - cum) * 100);
  } else if (market.includes('Over 2.5')) {
    let cum = 0;
    for (let i = 0; i < 3; i++) cum += (Math.exp(-totalXG) * Math.pow(totalXG, i)) / factorial(i);
    xgProb = Math.min(99, (1 - cum) * 100);
  } else if (market.includes('Over 3.5')) {
    let cum = 0;
    for (let i = 0; i < 4; i++) cum += (Math.exp(-totalXG) * Math.pow(totalXG, i)) / factorial(i);
    xgProb = Math.min(99, (1 - cum) * 100);
  } else if (market.includes('Ambas')) {
    const homeScores = 1 - Math.exp(-(totalXG * 0.55));
    const awayScores = 1 - Math.exp(-(totalXG * 0.45));
    xgProb = Math.min(99, homeScores * awayScores * 100);
  } else {
    return poissonProbVal;
  }

  return Math.round(poissonProbVal * 0.6 + xgProb * 0.4);
}

/**
 * Bayesian regression to league mean
 * lambda_adj = (n * team_avg + k * league_avg) / (n + k)
 */
function bayesianLambda(teamAvg: number, leagueAvg: number, n: number, k = 3): number {
  if (n === 0) return leagueAvg;
  return (n * teamAvg + k * leagueAvg) / (n + k);
}

function buildScoreMatrix(homeLambda: number, awayLambda: number, maxGoals = 7): number[][] {
  const matrix: number[][] = [];
  for (let h = 0; h <= maxGoals; h++) {
    matrix[h] = [];
    for (let a = 0; a <= maxGoals; a++) {
      matrix[h][a] = scoreProbability(homeLambda, awayLambda, h, a);
    }
  }
  return matrix;
}

/**
 * PRO Mode filter: only valid bets pass
 */
export function isValidBet(probability: number, ev: number = 0): boolean {
  return probability >= 60 && ev >= 0;
}

export function analyzeMarkets(match: MatchData): MarketAnalysis[] {
  const markets: MarketAnalysis[] = [];
  const isLive = match.isLive;

  const hGF = match.modelData?.homeGoalsAvg || (match as any).homeStats?.goalsFor || 0;
  const aGF = match.modelData?.awayGoalsAvg || (match as any).awayStats?.goalsFor || 0;
  const hGA = (match as any).modelData?.homeGoalsAgainstAvg || (match as any).homeStats?.goalsAgainst || 0;
  const aGA = (match as any).modelData?.awayGoalsAgainstAvg || (match as any).awayStats?.goalsAgainst || 0;

  // Dynamic league average from backend, fallback to conservative estimate
  const leagueAvg = (match as any).homeStats?.leagueAvg || (match as any).awayStats?.leagueAvg || 1.30;

  // Sample sizes for Bayesian regression
  const homeN = match.sampleSize?.homeGames || (match as any).homeStats?.gamesCount || 0;
  const awayN = match.sampleSize?.awayGames || (match as any).awayStats?.gamesCount || 0;

  // Bayesian-adjusted lambdas (replaces fixed fallback of 1.2/0.9)
  const adjHGF = bayesianLambda(hGF, leagueAvg, homeN);
  const adjAGA = bayesianLambda(aGA, leagueAvg, awayN);
  const adjAGF = bayesianLambda(aGF, leagueAvg, awayN);
  const adjHGA = bayesianLambda(hGA, leagueAvg, homeN);

  const homeLambda = adjHGF > 0 && adjAGA > 0
    ? (adjHGF / leagueAvg) * (adjAGA / leagueAvg) * leagueAvg
    : adjHGF;
  const awayLambda = adjAGF > 0 && adjHGA > 0
    ? (adjAGF / leagueAvg) * (adjHGA / leagueAvg) * leagueAvg
    : adjAGF;

  const totalLambda = homeLambda + awayLambda;
  const combinedAPM = calculateCombinedAPM(match);
  const passesAPMGate = combinedAPM >= 0.8;
  const { homeXG, awayXG } = getExpectedGoals(match);
  const totalXG = homeXG + awayXG;

  const lH = (match as any).stats?.home || { dangerousAttacks: 0, corners: 0, possession: 0, shotsOnGoal: 0 };
  const lA = (match as any).stats?.away || { dangerousAttacks: 0, corners: 0, possession: 0, shotsOnGoal: 0 };

  const scoreMatrix = buildScoreMatrix(homeLambda, awayLambda);

  // ════════════════════════════════════════
  // MERCADO: GOLS
  // ════════════════════════════════════════
  if (isLive) {
    // Use proxy for dangerousAttacks if 0
    const hDA = lH.dangerousAttacks > 0 ? lH.dangerousAttacks : (lH.shotsOnGoal || 0) * 1.5 + (lH.corners || 0) * 2;
    const aDA = lA.dangerousAttacks > 0 ? lA.dangerousAttacks : (lA.shotsOnGoal || 0) * 1.5 + (lA.corners || 0) * 2;
    const liveExpected = ((hDA + aDA) / 20) + ((lH.shotsOnGoal + lA.shotsOnGoal) * 0.2);
    const o15 = Math.min(95, Math.max(30, liveExpected * 35));
    const o25 = Math.min(90, Math.max(15, liveExpected * 22));
    markets.push({ market: 'Over 1.5 Gols', probability: Math.floor(o15), risk: o15 > 80 ? 'Baixo' : 'Médio', category: 'goals' });
    markets.push({ market: 'Over 2.5 Gols', probability: Math.floor(o25), risk: o25 > 65 ? 'Médio' : 'Alto', category: 'goals' });
  } else {
    const rawO05 = Math.round(poissonOver(totalLambda, 1) * 100);
    const o05 = crossValidateWithXG(rawO05, totalXG, 'Over 0.5');
    markets.push({ market: 'Over 0.5 Gols', probability: o05, risk: 'Baixo', category: 'goals' });

    const rawO15 = Math.round(poissonOver(totalLambda, 2) * 100);
    const o15 = crossValidateWithXG(rawO15, totalXG, 'Over 1.5');
    if (passesAPMGate) {
      markets.push({ market: 'Over 1.5 Gols', probability: o15, risk: o15 > 80 ? 'Baixo' : 'Médio', category: 'goals' });
    }

    const rawO25 = Math.round(poissonOver(totalLambda, 3) * 100);
    const o25 = crossValidateWithXG(rawO25, totalXG, 'Over 2.5');
    if (passesAPMGate) {
      markets.push({ market: 'Over 2.5 Gols', probability: o25, risk: o25 > 65 ? 'Médio' : 'Alto', category: 'goals' });
    }

    const rawO35 = Math.round(poissonOver(totalLambda, 4) * 100);
    const o35 = crossValidateWithXG(rawO35, totalXG, 'Over 3.5');
    if (o35 >= 20 && passesAPMGate) {
      markets.push({ market: 'Over 3.5 Gols', probability: o35, risk: 'Alto', category: 'goals' });
    }
  }

  // ════════════════════════════════════════
  // MERCADO: AMBAS MARCAM (BTTS)
  // ════════════════════════════════════════
  if (isLive) {
    const btts = lH.shotsOnGoal > 0 && lA.shotsOnGoal > 0 ? 75 : 40;
    markets.push({ market: 'Ambas Marcam', probability: btts, risk: 'Médio', category: 'btts' });
  } else {
    const pHome0 = Math.exp(-homeLambda);
    const pAway0 = Math.exp(-awayLambda);
    const p00 = pHome0 * pAway0;
    const rawBtts = Math.round((1 - pHome0 - pAway0 + p00) * 100);
    const bttsProb = crossValidateWithXG(rawBtts, totalXG, 'Ambas Marcam');
    markets.push({ market: 'Ambas Marcam', probability: Math.min(95, bttsProb), risk: bttsProb > 65 ? 'Médio' : 'Alto', category: 'btts' });
  }

  // ════════════════════════════════════════
  // MERCADO: GOL NO 1° TEMPO / 2° TEMPO
  // ════════════════════════════════════════
  if (isLive) {
    const htLive = Math.min(90, Math.max(40, (lH.shotsOnGoal + lA.shotsOnGoal) * 15));
    markets.push({ market: 'Gol no 1° Tempo', probability: Math.floor(htLive), risk: 'Baixo', category: 'htft' });
  } else {
    const htLambda = totalLambda * 0.45;
    const htProb = Math.round((1 - Math.exp(-htLambda)) * 100);
    markets.push({ market: 'Gol no 1° Tempo', probability: Math.min(95, htProb), risk: htProb > 75 ? 'Baixo' : 'Médio', category: 'htft' });

    const ftLambda = totalLambda * 0.55;
    const ftProb = Math.round((1 - Math.exp(-ftLambda)) * 100);
    markets.push({ market: 'Gol no 2° Tempo', probability: Math.min(95, ftProb), risk: ftProb > 75 ? 'Baixo' : 'Médio', category: 'htft' });
  }

  // ════════════════════════════════════════
  // MERCADO: ESCANTEIOS
  // ════════════════════════════════════════
  if (!isLive) {
    const hCorners = match.modelData?.homeCornersAvg || (match as any).homeStats?.corners || 0;
    const aCorners = match.modelData?.awayCornersAvg || (match as any).awayStats?.corners || 0;
    const totalCorners = hCorners + aCorners;

    if (totalCorners > 0) {
      const o55 = Math.round(poissonOver(totalCorners, 6) * 100);
      if (o55 >= 40) {
        markets.push({ market: 'Over 5.5 Cantos', probability: Math.min(95, o55), risk: o55 > 80 ? 'Baixo' : 'Médio', category: 'corners' });
      }

      const o75 = Math.round(poissonOver(totalCorners, 8) * 100);
      if (o75 >= 30) {
        markets.push({ market: 'Over 7.5 Cantos', probability: Math.min(95, o75), risk: o75 > 70 ? 'Baixo' : 'Médio', category: 'corners' });
      }

      const o95 = Math.round(poissonOver(totalCorners, 10) * 100);
      if (o95 >= 20) {
        markets.push({ market: 'Over 9.5 Cantos', probability: Math.min(90, o95), risk: 'Alto', category: 'corners' });
      }
    }
  }

  // ════════════════════════════════════════
  // MERCADO: CARTÕES
  // ════════════════════════════════════════
  if (!isLive) {
    const hCards = match.modelData?.homeCardsAvg || (match as any).homeStats?.yellowCards || 0;
    const aCards = match.modelData?.awayCardsAvg || (match as any).awayStats?.yellowCards || 0;
    const totalCards = hCards + aCards;

    if (totalCards > 0) {
      const o25c = Math.round(poissonOver(totalCards, 3) * 100);
      if (o25c >= 30) {
        markets.push({ market: 'Over 2.5 Cartões', probability: Math.min(95, o25c), risk: o25c > 75 ? 'Baixo' : 'Médio', category: 'cards' });
      }

      const o35c = Math.round(poissonOver(totalCards, 4) * 100);
      if (o35c >= 20) {
        markets.push({ market: 'Over 3.5 Cartões', probability: Math.min(90, o35c), risk: o35c > 65 ? 'Médio' : 'Alto', category: 'cards' });
      }

      const o45c = Math.round(poissonOver(totalCards, 5) * 100);
      if (o45c >= 15) {
        markets.push({ market: 'Over 4.5 Cartões', probability: Math.min(85, o45c), risk: 'Alto', category: 'cards' });
      }
    }
  }

  // ════════════════════════════════════════
  // MERCADO: RESULTADO — Poisson bivariado + Handicap
  // ════════════════════════════════════════
  if (!isLive) {
    let pHomeWin = 0, pDraw = 0, pAwayWin = 0;
    let pHomeWin2Plus = 0, pAwayWin2Plus = 0;

    for (let h = 0; h <= 7; h++) {
      for (let a = 0; a <= 7; a++) {
        const p = scoreProbability(homeLambda, awayLambda, h, a);
        if (h > a) {
          pHomeWin += p;
          if (h - a >= 2) pHomeWin2Plus += p;
        } else if (h === a) {
          pDraw += p;
        } else {
          pAwayWin += p;
          if (a - h >= 2) pAwayWin2Plus += p;
        }
      }
    }

    const homeWinProb = Math.round(pHomeWin * 100);
    const drawProb = Math.round(pDraw * 100);
    const awayWinProb = Math.round(pAwayWin * 100);

    if (homeWinProb >= 35) {
      markets.push({ market: 'Vitória Casa', probability: Math.min(95, homeWinProb), risk: homeWinProb > 55 ? 'Médio' : 'Alto', category: 'result' });
    }
    if (awayWinProb >= 35) {
      markets.push({ market: 'Vitória Fora', probability: Math.min(95, awayWinProb), risk: awayWinProb > 55 ? 'Médio' : 'Alto', category: 'result' });
    }

    const dc1X = homeWinProb + drawProb;
    const dcX2 = awayWinProb + drawProb;

    if (dc1X >= 50) {
      markets.push({ market: '1X (Casa ou Empate)', probability: Math.min(95, dc1X), risk: dc1X > 75 ? 'Baixo' : 'Médio', category: 'chance_dupla' });
    }
    if (dcX2 >= 50) {
      markets.push({ market: 'X2 (Empate ou Fora)', probability: Math.min(95, dcX2), risk: dcX2 > 75 ? 'Baixo' : 'Médio', category: 'chance_dupla' });
    }

    const hcHome = Math.round(pHomeWin2Plus * 100);
    const hcAway = Math.round(pAwayWin2Plus * 100);

    if (hcHome >= 20) {
      markets.push({ market: 'Handicap -1 Casa', probability: Math.min(90, hcHome), risk: hcHome > 40 ? 'Médio' : 'Alto', category: 'handicap' });
    }
    if (hcAway >= 20) {
      markets.push({ market: 'Handicap -1 Fora', probability: Math.min(90, hcAway), risk: hcAway > 40 ? 'Médio' : 'Alto', category: 'handicap' });
    }

    let pAwayWin1 = 0, pHomeWin1 = 0;
    for (let h = 0; h <= 7; h++) {
      for (let a = 0; a <= 7; a++) {
        const p = scoreProbability(homeLambda, awayLambda, h, a);
        if (a - h === 1) pAwayWin1 += p;
        if (h - a === 1) pHomeWin1 += p;
      }
    }

    const hcPlus1Home = Math.round((pHomeWin + pDraw + pAwayWin1) * 100);
    const hcPlus1Away = Math.round((pAwayWin + pDraw + pHomeWin1) * 100);

    if (hcPlus1Home >= 50 && hcPlus1Home <= 95) {
      markets.push({ market: 'Handicap +1 Casa', probability: hcPlus1Home, risk: hcPlus1Home > 75 ? 'Baixo' : 'Médio', category: 'handicap' });
    }
    if (hcPlus1Away >= 50 && hcPlus1Away <= 95) {
      markets.push({ market: 'Handicap +1 Fora', probability: hcPlus1Away, risk: hcPlus1Away > 75 ? 'Baixo' : 'Médio', category: 'handicap' });
    }
  } else {
    // Use proxy for DA if 0
    const hDA = lH.dangerousAttacks > 0 ? lH.dangerousAttacks : (lH.shotsOnGoal || 0) * 1.5 + (lH.corners || 0) * 2;
    const aDA = lA.dangerousAttacks > 0 ? lA.dangerousAttacks : (lA.shotsOnGoal || 0) * 1.5 + (lA.corners || 0) * 2;
    const homeStrength = (hDA + (lH.shotsOnGoal || 0) * 2) || 1;
    const awayStrength = (aDA + (lA.shotsOnGoal || 0) * 2) || 1;
    const total = homeStrength + awayStrength;
    const dominantProb = Math.round((Math.max(homeStrength, awayStrength) / total) * 85);
    const dcLabel = homeStrength >= awayStrength ? '1X (Casa ou Empate)' : 'X2 (Empate ou Fora)';
    markets.push({ market: dcLabel, probability: dominantProb, risk: 'Médio', category: 'chance_dupla' });
  }

  return markets;
}

export function getBestMarketForProfile(markets: MarketAnalysis[], profile: 'conservador' | 'moderado' | 'agressivo') {
  const thresholds = { conservador: 78, moderado: 68, agressivo: 58 };
  const minProb = thresholds[profile];
  const filtered = markets.filter(m => m.probability >= minProb && isValidBet(m.probability));
  return filtered.sort((a, b) => b.probability - a.probability)[0] || null;
}
