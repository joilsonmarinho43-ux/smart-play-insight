import { MatchData, MarketAnalysis } from '@/types/match';

/**
 * Análise REAL de mercados — Poisson + xG cross-validation
 * Weighted Average dos últimos 5 jogos + APM gate
 * Threshold mínimo de 78% para sugestões de Bingo
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

/**
 * Calcula APM (Ataques Perigosos por Minuto) combinado
 * Usa dados de finalizações como proxy quando dangerousAttacks não disponível
 */
function calculateCombinedAPM(match: MatchData): number {
  const hDA = (match as any).homeStats?.dangerousAttacks || 0;
  const aDA = (match as any).awayStats?.dangerousAttacks || 0;
  const hShots = (match as any).homeStats?.totalShots || 0;
  const aShots = (match as any).awayStats?.totalShots || 0;
  const hSoG = (match as any).homeStats?.shotsOnGoal || 0;
  const aSoG = (match as any).awayStats?.shotsOnGoal || 0;

  // Se temos ataques perigosos reais, usar diretamente (média por 90 min)
  if (hDA > 0 || aDA > 0) {
    return (hDA + aDA) / 90;
  }

  // Proxy APM via finalizações: (totalShots * 1.5 + shotsOnGoal * 2) / 90
  const proxyAttacks = (hShots + aShots) * 1.5 + (hSoG + aSoG) * 2;
  return proxyAttacks / 90;
}

/**
 * Extrai xG (Expected Goals) se disponível, senão estima via SoG ratio
 */
function getExpectedGoals(match: MatchData): { homeXG: number; awayXG: number } {
  const hXG = (match as any).homeStats?.bigChances || (match as any).homeStats?.expectedGoals || 0;
  const aXG = (match as any).awayStats?.bigChances || (match as any).awayStats?.expectedGoals || 0;

  if (hXG > 0 || aXG > 0) {
    return { homeXG: hXG, awayXG: aXG };
  }

  // Estima xG via SoG ratio (conversion rate ~32% em média)
  const hSoG = (match as any).homeStats?.shotsOnGoal || 0;
  const aSoG = (match as any).awayStats?.shotsOnGoal || 0;
  return {
    homeXG: hSoG * 0.32,
    awayXG: aSoG * 0.32,
  };
}

/**
 * Cross-valida probabilidade Poisson com xG
 * Retorna probabilidade ajustada (média ponderada: 60% Poisson, 40% xG)
 */
function crossValidateWithXG(poissonProb: number, totalXG: number, market: string): number {
  if (totalXG <= 0) return poissonProb; // Sem xG, confia só no Poisson

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
    return poissonProb; // Mercados sem cross-validation de xG
  }

  // Média ponderada: 60% Poisson + 40% xG
  return Math.round(poissonProb * 0.6 + xgProb * 0.4);
}

export function analyzeMarkets(match: MatchData): MarketAnalysis[] {
  const markets: MarketAnalysis[] = [];
  const isLive = match.isLive;

  // Dados REAIS — weighted average dos últimos 5 jogos (já calculado no backend)
  const hGF = match.modelData?.homeGoalsAvg || (match as any).homeStats?.goalsFor || 0;
  const aGF = match.modelData?.awayGoalsAvg || (match as any).awayStats?.goalsFor || 0;
  const hGA = (match as any).modelData?.homeGoalsAgainstAvg || (match as any).homeStats?.goalsAgainst || 0;
  const aGA = (match as any).modelData?.awayGoalsAgainstAvg || (match as any).awayStats?.goalsAgainst || 0;

  // Lambda Poisson: ataque do time vs defesa do oponente
  const leagueAvg = 1.35;
  const homeLambda = hGF > 0 && aGA > 0
    ? (hGF / leagueAvg) * (aGA / leagueAvg) * leagueAvg
    : hGF || 1.2;
  const awayLambda = aGF > 0 && hGA > 0
    ? (aGF / leagueAvg) * (hGA / leagueAvg) * leagueAvg
    : aGF || 0.9;

  const totalLambda = homeLambda + awayLambda;

  // APM combinado para gate de mercados
  const combinedAPM = calculateCombinedAPM(match);
  const passesAPMGate = combinedAPM >= 1.2;

  // xG para cross-validation
  const { homeXG, awayXG } = getExpectedGoals(match);
  const totalXG = homeXG + awayXG;

  // Live stats reais (da API em tempo real)
  const lH = (match as any).stats?.home || { dangerousAttacks: 0, corners: 0, possession: 0, shotsOnGoal: 0 };
  const lA = (match as any).stats?.away || { dangerousAttacks: 0, corners: 0, possession: 0, shotsOnGoal: 0 };

  // ════════════════════════════════════════
  // MERCADO: GOLS (Poisson + xG cross-validation + APM gate)
  // ════════════════════════════════════════
  if (isLive) {
    const liveExpected = ((lH.dangerousAttacks + lA.dangerousAttacks) / 20) + ((lH.shotsOnGoal + lA.shotsOnGoal) * 0.2);
    const o15 = Math.min(95, Math.max(30, liveExpected * 35));
    const o25 = Math.min(90, Math.max(15, liveExpected * 22));
    markets.push({ market: 'Over 1.5 Gols', probability: Math.floor(o15), risk: o15 > 80 ? 'Baixo' : 'Médio', category: 'goals' });
    markets.push({ market: 'Over 2.5 Gols', probability: Math.floor(o25), risk: o25 > 65 ? 'Médio' : 'Alto', category: 'goals' });
  } else {
    // Over 0.5
    const rawO05 = Math.round(poissonOver(totalLambda, 1) * 100);
    const o05 = crossValidateWithXG(rawO05, totalXG, 'Over 0.5');
    markets.push({ market: 'Over 0.5 Gols', probability: o05, risk: 'Baixo', category: 'goals' });

    // Over 1.5 — APM gate: só sugere se APM ≥ 1.2
    const rawO15 = Math.round(poissonOver(totalLambda, 2) * 100);
    const o15 = crossValidateWithXG(rawO15, totalXG, 'Over 1.5');
    if (passesAPMGate) {
      markets.push({ market: 'Over 1.5 Gols', probability: o15, risk: o15 > 80 ? 'Baixo' : 'Médio', category: 'goals' });
    }

    // Over 2.5 — APM gate
    const rawO25 = Math.round(poissonOver(totalLambda, 3) * 100);
    const o25 = crossValidateWithXG(rawO25, totalXG, 'Over 2.5');
    if (passesAPMGate) {
      markets.push({ market: 'Over 2.5 Gols', probability: o25, risk: o25 > 65 ? 'Médio' : 'Alto', category: 'goals' });
    }

    // Over 3.5 — APM gate
    const rawO35 = Math.round(poissonOver(totalLambda, 4) * 100);
    const o35 = crossValidateWithXG(rawO35, totalXG, 'Over 3.5');
    if (o35 >= 20 && passesAPMGate) {
      markets.push({ market: 'Over 3.5 Gols', probability: o35, risk: 'Alto', category: 'goals' });
    }
  }

  // ════════════════════════════════════════
  // MERCADO: AMBAS MARCAM (Poisson + xG cross-validation)
  // ════════════════════════════════════════
  if (isLive) {
    const btts = lH.shotsOnGoal > 0 && lA.shotsOnGoal > 0 ? 75 : 40;
    markets.push({ market: 'Ambas Marcam', probability: btts, risk: 'Médio', category: 'goals' });
  } else {
    const pHomeScores = 1 - Math.exp(-homeLambda);
    const pAwayScores = 1 - Math.exp(-awayLambda);
    const rawBtts = Math.round(pHomeScores * pAwayScores * 100);
    const bttsProb = crossValidateWithXG(rawBtts, totalXG, 'Ambas Marcam');
    markets.push({ market: 'Ambas Marcam', probability: bttsProb, risk: bttsProb > 65 ? 'Médio' : 'Alto', category: 'goals' });
  }

  // ════════════════════════════════════════
  // MERCADO: GOL NO 1° TEMPO (Poisson + xG)
  // ════════════════════════════════════════
  if (isLive) {
    const htLive = Math.min(90, Math.max(40, (lH.shotsOnGoal + lA.shotsOnGoal) * 15));
    markets.push({ market: 'Over 0.5 HT', probability: Math.floor(htLive), risk: 'Baixo', category: 'goals' });
  } else {
    const htLambda = totalLambda * 0.45;
    const htProb = Math.round((1 - Math.exp(-htLambda)) * 100);
    markets.push({ market: 'Over 0.5 HT', probability: htProb, risk: htProb > 75 ? 'Baixo' : 'Médio', category: 'goals' });
  }

  // ════════════════════════════════════════
  // MERCADO: ESCANTEIOS (APM gate ≥ 1.2)
  // ════════════════════════════════════════
  if (!isLive) {
    const hCorners = match.modelData?.homeCornersAvg || (match as any).homeStats?.corners || 0;
    const aCorners = match.modelData?.awayCornersAvg || (match as any).awayStats?.corners || 0;
    const totalCorners = hCorners + aCorners;

    if (passesAPMGate && totalCorners > 0) {
      const o75 = Math.min(95, Math.round(Math.max(0, (totalCorners - 7.5) / 3) * 60 + 40));
      if (totalCorners >= 9) {
        markets.push({ market: 'Over 7.5 Cantos', probability: o75, risk: o75 > 75 ? 'Baixo' : 'Médio', category: 'corners' });
      }
      const o95 = Math.min(90, Math.round(Math.max(0, (totalCorners - 9.5) / 3) * 55 + 35));
      if (totalCorners >= 10.5) {
        markets.push({ market: 'Over 9.5 Cantos', probability: o95, risk: 'Médio', category: 'corners' });
      }
    }
  }

  // ════════════════════════════════════════
  // MERCADO: RESULTADO (Poisson bivariado real)
  // ════════════════════════════════════════
  if (!isLive) {
    let pHomeWin = 0, pDraw = 0, pAwayWin = 0;
    for (let h = 0; h <= 6; h++) {
      for (let a = 0; a <= 6; a++) {
        const p = scoreProbability(homeLambda, awayLambda, h, a);
        if (h > a) pHomeWin += p;
        else if (h === a) pDraw += p;
        else pAwayWin += p;
      }
    }

    const homeWinProb = Math.round(pHomeWin * 100);
    const drawProb = Math.round(pDraw * 100);
    const awayWinProb = Math.round(pAwayWin * 100);

    if (homeLambda >= awayLambda) {
      const dcProb = homeWinProb + drawProb;
      markets.push({ market: '1X (Casa ou Empate)', probability: Math.min(95, dcProb), risk: dcProb > 75 ? 'Baixo' : 'Médio', category: 'result' });
    } else {
      const dcProb = awayWinProb + drawProb;
      markets.push({ market: 'X2 (Empate ou Fora)', probability: Math.min(95, dcProb), risk: dcProb > 75 ? 'Baixo' : 'Médio', category: 'result' });
    }

    if (homeWinProb >= 40) {
      markets.push({ market: 'Vitória Casa', probability: homeWinProb, risk: homeWinProb > 55 ? 'Médio' : 'Alto', category: 'result' });
    }
    if (awayWinProb >= 40) {
      markets.push({ market: 'Vitória Fora', probability: awayWinProb, risk: awayWinProb > 55 ? 'Médio' : 'Alto', category: 'result' });
    }
  } else {
    const homeStrength = (lH.dangerousAttacks + lH.shotsOnGoal * 2) || 1;
    const awayStrength = (lA.dangerousAttacks + lA.shotsOnGoal * 2) || 1;
    const total = homeStrength + awayStrength;
    const dominantProb = Math.round((Math.max(homeStrength, awayStrength) / total) * 85);
    const dcLabel = homeStrength >= awayStrength ? '1X (Casa ou Empate)' : 'X2 (Empate ou Fora)';
    markets.push({ market: dcLabel, probability: dominantProb, risk: 'Médio', category: 'result' });
  }

  return markets;
}

export function getBestMarketForProfile(markets: MarketAnalysis[], profile: 'conservador' | 'moderado' | 'agressivo') {
  const thresholds = { conservador: 78, moderado: 68, agressivo: 58 };
  const minProb = thresholds[profile];
  const filtered = markets.filter(m => m.probability >= minProb);
  return filtered.sort((a, b) => b.probability - a.probability)[0] || null;
}
