import { MatchData, MarketAnalysis } from '@/types/match';

/** Canonical market model: no fabricated samples and no Big Chances -> xG. */
function factorial(n: number): number { if (!Number.isInteger(n) || n < 0) return 1; let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }
function poisson(lambda: number, k: number): number { if (!Number.isFinite(lambda) || lambda < 0 || k < 0) return 0; return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k); }
function poissonOver(lambda: number, line: number): number { if (!Number.isFinite(lambda) || lambda < 0) return 0; let c = 0; for (let k = 0; k <= Math.floor(line); k++) c += poisson(lambda, k); return Math.max(0, Math.min(1, 1 - c)); }
function pct(v: number): number { return Math.max(0, Math.min(100, Math.round(v * 100))); }
function bayes(value: number, prior: number, n: number, strength = 3): number { if (!Number.isFinite(value) || !Number.isFinite(prior) || prior <= 0 || !Number.isFinite(n) || n <= 0) return prior; return (n * value + strength * prior) / (n + strength); }
function resultProbabilities(h: number, a: number) { let home = 0, draw = 0, away = 0; for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) { const p = poisson(h, i) * poisson(a, j); if (i > j) home += p; else if (i === j) draw += p; else away += p; } const sum = home + draw + away; return sum ? { home: home / sum, draw: draw / sum, away: away / sum } : { home: 0, draw: 0, away: 0 }; }
function realXG(match: MatchData): { home: number | null; away: number | null } { const h = (match as any).homeStats?.expectedGoals; const a = (match as any).awayStats?.expectedGoals; return { home: typeof h === 'number' && Number.isFinite(h) && h >= 0 ? h : null, away: typeof a === 'number' && Number.isFinite(a) && a >= 0 ? a : null }; }
function add(markets: MarketAnalysis[], market: string, probability: number, risk: string, category: string, source: MarketAnalysis['probabilitySource'], calibration: MarketAnalysis['calibrationStatus'] = 'UNCALIBRATED') { if (!Number.isFinite(probability)) return; markets.push({ market, probability: Math.max(0, Math.min(100, Math.round(probability))), risk, category, probabilitySource: source, calibrationStatus: calibration }); }

export function isValidBet(probability: number, ev = 0): boolean { return Number.isFinite(probability) && probability >= 60 && Number.isFinite(ev) && ev >= 0; }

export function analyzeMarkets(match: MatchData): MarketAnalysis[] {
  const markets: MarketAnalysis[] = [];
  const h = (match as any).homeStats || {};
  const a = (match as any).awayStats || {};
  const homeN = Number(match.sampleSize?.homeGames ?? h.gamesCount ?? 0);
  const awayN = Number(match.sampleSize?.awayGames ?? a.gamesCount ?? 0);
  const n = Math.min(homeN, awayN);
  const leagueRaw = Number(h.leagueAvg ?? a.leagueAvg ?? 0);
  const league = Number.isFinite(leagueRaw) && leagueRaw > 0 ? leagueRaw : null;
  const hGF = Number(match.modelData?.homeGoalsAvg ?? h.goalsFor ?? 0);
  const aGF = Number(match.modelData?.awayGoalsAvg ?? a.goalsFor ?? 0);
  const hGA = Number(match.modelData?.homeGoalsAgainstAvg ?? h.goalsAgainst ?? 0);
  const aGA = Number(match.modelData?.awayGoalsAgainstAvg ?? a.goalsAgainst ?? 0);

  if (n >= 3 && league !== null && [hGF, aGF, hGA, aGA].every(Number.isFinite)) {
    const hAttack = bayes(hGF, league, homeN), aDefense = bayes(aGA, league, awayN);
    const aAttack = bayes(aGF, league, awayN), hDefense = bayes(hGA, league, homeN);
    const homeLambda = Math.max(0.01, (hAttack / league) * (aDefense / league) * league);
    const awayLambda = Math.max(0.01, (aAttack / league) * (hDefense / league) * league);
    const total = homeLambda + awayLambda;
    const xg = realXG(match);
    const totalXG = xg.home !== null && xg.away !== null ? xg.home + xg.away : null;

    let o15 = pct(poissonOver(total, 1.5));
    let o25 = pct(poissonOver(total, 2.5));
    const o35 = pct(poissonOver(total, 3.5));
    const btts = pct((1 - Math.exp(-homeLambda)) * (1 - Math.exp(-awayLambda)));
    if (totalXG !== null) { o15 = Math.round(o15 * 0.6 + pct(poissonOver(totalXG, 1.5)) * 0.4); o25 = Math.round(o25 * 0.6 + pct(poissonOver(totalXG, 2.5)) * 0.4); }
    add(markets, 'Over 0.5 Gols', pct(poissonOver(total, 0.5)), 'Baixo', 'goals', 'MODEL_ESTIMATE');
    add(markets, 'Over 1.5 Gols', o15, o15 >= 80 ? 'Baixo' : 'Médio', 'goals', 'MODEL_ESTIMATE');
    add(markets, 'Over 2.5 Gols', o25, o25 >= 65 ? 'Médio' : 'Alto', 'goals', 'MODEL_ESTIMATE');
    if (o35 >= 20) add(markets, 'Over 3.5 Gols', o35, 'Alto', 'goals', 'MODEL_ESTIMATE');
    add(markets, 'Under 2.5 Gols', 100 - o25, 'Alto', 'goals', 'DERIVED');
    add(markets, 'Ambas Marcam', btts, btts >= 65 ? 'Médio' : 'Alto', 'btts', 'MODEL_ESTIMATE');

    const r = resultProbabilities(homeLambda, awayLambda);
    if (r.home >= 0.35) add(markets, 'Vitória Casa', pct(r.home), r.home >= 0.55 ? 'Médio' : 'Alto', 'result', 'MODEL_ESTIMATE');
    if (r.draw >= 0.28) add(markets, 'Empate', pct(r.draw), 'Alto', 'result', 'MODEL_ESTIMATE');
    if (r.away >= 0.35) add(markets, 'Vitória Fora', pct(r.away), r.away >= 0.55 ? 'Médio' : 'Alto', 'result', 'MODEL_ESTIMATE');
    if (r.home + r.draw >= 0.62) add(markets, '1X (Casa ou Empate)', pct(r.home + r.draw), 'Médio', 'chance_dupla', 'MODEL_ESTIMATE');
    if (r.away + r.draw >= 0.62) add(markets, 'X2 (Empate ou Fora)', pct(r.away + r.draw), 'Médio', 'chance_dupla', 'MODEL_ESTIMATE');
    add(markets, 'Gol no 1º Tempo', pct(1 - Math.exp(-(total * 0.45))), 'Médio', 'htft', 'MODEL_ESTIMATE');
    add(markets, 'Gol no 2º Tempo', pct(1 - Math.exp(-(total * 0.55))), 'Médio', 'htft', 'MODEL_ESTIMATE');

    const hc = Number(match.modelData?.homeCornersAvg), ac = Number(match.modelData?.awayCornersAvg);
    if (Number.isFinite(hc) && Number.isFinite(ac) && hc >= 0 && ac >= 0 && n >= 5) {
      const lambda = bayes(hc + ac, 9.8, n, 4);
      const o65 = pct(poissonOver(lambda, 6.5));
      if (o65 >= 70) add(markets, 'Over 6.5 Cantos', o65, o65 >= 78 ? 'Baixo' : 'Médio', 'corners', 'MODEL_ESTIMATE');
    }
    const hcard = Number(match.modelData?.homeCardsAvg), acard = Number(match.modelData?.awayCardsAvg);
    if (Number.isFinite(hcard) && Number.isFinite(acard) && hcard >= 0 && acard >= 0 && n >= 5) {
      const lambda = bayes(hcard + acard, 4.3, n, 4), o35c = pct(poissonOver(lambda, 3.5));
      if (o35c >= 70) add(markets, 'Over 3.5 Cartões', o35c, o35c >= 78 ? 'Médio' : 'Alto', 'cards', 'MODEL_ESTIMATE');
    }
  }

  // Live pressure is deliberately an observation, never a probability.
  const live = (match as any).liveStats;
  if (match.isLive === true && live) {
    const da = Number(live.dangerousAttacks?.[0] ?? 0) + Number(live.dangerousAttacks?.[1] ?? 0);
    const sog = Number(live.shotsOnGoal?.[0] ?? 0) + Number(live.shotsOnGoal?.[1] ?? 0);
    const corners = Number(live.corners?.[0] ?? 0) + Number(live.corners?.[1] ?? 0);
    const pressure = Math.min(100, Math.round(da * 0.7 + sog * 6 + corners * 3));
    add(markets, 'Pressão Ofensiva ao Vivo', pressure, pressure >= 70 ? 'Médio' : 'Alto', 'live_pressure', 'HEURISTIC');
  }
  return markets;
}
