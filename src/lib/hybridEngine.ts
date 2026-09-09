/**
 * HYBRID SIGNAL ENGINE
 * Classifica jogos LIVE em 3 níveis: SNIPER 🔥, SEMI ⚡, NORMAL 🔍
 * Camada analítica — não executa apostas.
 */

export type HybridTier = 'SNIPER' | 'SEMI' | 'NORMAL';

export interface HybridSignal {
  matchId: string;
  match: string;
  league: string;
  minute: number;
  tier: HybridTier;
  label: string;
  confidence: 'alta' | 'média' | 'padrão';
  market: string;
  /** Analytically eligible for Nexus signal review; never means order execution. */
  signalEligible: boolean;
  signalReason: string;
  /** Timestamp of the source snapshot, when supplied by the upstream adapter. */
  observedAt: string | null;
  shotsOnGoal: number;
  totalShots: number;
  corners: number;
  dangerousAttacks: number;
  /** True when dangerousAttacks was estimated via fallback (API returned 0). */
  daEstimated: boolean;
  possession: number;
  pressure: number;
  homeGoals: number;
  awayGoals: number;
}

/** Historical analytical tracking; result describes the observed match outcome. */
export interface HybridOperation {
  id: string;
  matchId: string;
  match: string;
  tier: HybridTier;
  minute: number;
  market: string;
  pressure: number;
  entryTime: number;
  result: 'PENDING' | 'WIN' | 'LOSS' | 'CASHOUT';
  exitMinute?: number;
}

interface MatchSnapshot { minute: number; totalShots: number; corners: number; }
const SNAPSHOT_HISTORY: Record<string, MatchSnapshot[]> = {};

function recordSnapshot(matchId: string, minute: number, totalShots: number, corners: number) {
  if (!SNAPSHOT_HISTORY[matchId]) SNAPSHOT_HISTORY[matchId] = [];
  const hist = SNAPSHOT_HISTORY[matchId];
  const last = hist[hist.length - 1];
  if (!last || last.minute !== minute) {
    hist.push({ minute, totalShots, corners });
    if (hist.length > 30) hist.shift();
  } else {
    last.totalShots = totalShots;
    last.corners = corners;
  }
}

function hasRecentEvent(matchId: string, minute: number): boolean {
  const hist = SNAPSHOT_HISTORY[matchId];
  if (!hist || hist.length === 0) return false;
  const cutoff = minute - 10;
  const baseline = [...hist].reverse().find(h => h.minute <= cutoff) || hist[0];
  const current = hist[hist.length - 1];
  return current.totalShots - baseline.totalShots >= 1 || current.corners - baseline.corners >= 1;
}

function extractStats(match: any) {
  const minute = match.minute || match.fixture?.status?.elapsed || 0;
  const homeGoals = match.goals?.home ?? match.liveScore?.home ?? 0;
  const awayGoals = match.goals?.away ?? match.liveScore?.away ?? 0;
  const lH = match.stats?.home || {};
  const lA = match.stats?.away || {};
  const sog = (lH.shotsOnGoal || 0) + (lA.shotsOnGoal || 0);
  const totalShots = (lH.totalShots || 0) + (lA.totalShots || 0);
  const corners = (lH.corners || 0) + (lA.corners || 0);

  let da = (lH.dangerousAttacks || 0) + (lA.dangerousAttacks || 0);
  let daEstimated = false;
  if (da === 0 && (totalShots > 0 || corners > 0)) {
    da = Math.round(totalShots * 1.5 + corners * 2);
    daEstimated = true;
  }

  const homePoss = Number(lH.possession || 0);
  const awayPoss = Number(lA.possession || 0);
  const dominantPoss = Math.max(homePoss, awayPoss);
  const pressure = Math.min(100, Math.max(0, da * 2 + corners * 4 + sog * 8));
  const homeTeam = match.teams?.home?.name || match.homeTeam || 'Casa';
  const awayTeam = match.teams?.away?.name || match.awayTeam || 'Fora';
  const matchId = String(match.id || match.fixture?.id);
  const league = match.league?.name || match.league || '';
  const hasStats = !!(lH.shotsOnGoal || lA.shotsOnGoal || lH.dangerousAttacks || lA.dangerousAttacks || totalShots || corners);
  const observedAt = match.observedAt ?? match.updatedAt ?? match.lastUpdatedAt ?? null;

  if (matchId && hasStats && minute > 0) recordSnapshot(matchId, minute, totalShots, corners);
  return { minute, homeGoals, awayGoals, sog, totalShots, corners, da, daEstimated, dominantPoss, pressure, homeTeam, awayTeam, matchId, league, hasStats, observedAt };
}

function trySniper(s: ReturnType<typeof extractStats>): boolean {
  return s.minute >= 5 && s.minute <= 30 && s.homeGoals === 0 && s.awayGoals === 0 && s.sog >= 2 && s.dominantPoss >= 60 && s.da >= 8 && s.corners >= 2 && s.pressure >= 70;
}

function trySemi(s: ReturnType<typeof extractStats>): boolean {
  const validScore = (s.homeGoals === 0 && s.awayGoals === 0) || (s.homeGoals + s.awayGoals === 1);
  return s.minute >= 5 && s.minute <= 35 && validScore && s.sog >= 1 && s.dominantPoss >= 55 && s.da >= 6 && s.corners >= 1 && s.pressure >= 60;
}

function tryNormal(s: ReturnType<typeof extractStats>): boolean {
  return s.minute <= 70 && (s.sog >= 1 || s.da >= 5) && s.pressure >= 55;
}

export function classifyHybridSignal(match: any): HybridSignal | null {
  const liveStatuses = ['1H', '2H', 'HT', 'ET', 'P', 'LIVE'];
  const status = String(match?.fixture?.status?.short || '').toUpperCase();
  const isLive = match?.isLive === true || liveStatuses.includes(status);
  if (!isLive) return null;

  const s = extractStats(match);
  if (!s.hasStats) return null;

  const recentEvent = hasRecentEvent(s.matchId, s.minute);
  let tier: HybridTier;
  let label: string;
  let confidence: HybridSignal['confidence'];
  let market: string;
  let signalEligible: boolean;
  let signalReason: string;

  if (trySniper(s)) {
    if (!recentEvent && s.minute >= 15) return null;
    tier = 'SNIPER';
    label = 'SNIPER 🔥';
    confidence = 'alta';
    market = 'Over 0.5 HT';
    signalEligible = true;
    signalReason = 'Cenário LIVE atende aos filtros SNIPER';
  } else if (trySemi(s)) {
    if (!recentEvent && s.minute >= 15) return null;
    tier = 'SEMI';
    label = 'SEMI ⚡';
    confidence = 'média';
    market = s.homeGoals + s.awayGoals === 0 ? 'Over 0.5' : 'Over 1.5';
    const inWindow = s.minute >= 10 && s.minute <= 30;
    signalEligible = inWindow;
    signalReason = !inWindow ? `Fora da janela analítica (10-30'), atual: ${s.minute}'` : 'Cenário LIVE atende aos filtros SEMI';
  } else if (tryNormal(s)) {
    tier = 'NORMAL';
    label = 'NORMAL 🔍';
    confidence = 'padrão';
    market = 'Sugestão';
    signalEligible = false;
    signalReason = 'Apenas contexto analítico — confiança insuficiente para sinal forte';
  } else {
    return null;
  }

  return {
    matchId: s.matchId,
    match: `${s.homeTeam} vs ${s.awayTeam}`,
    league: s.league,
    minute: s.minute,
    tier,
    label,
    confidence,
    market,
    signalEligible,
    signalReason,
    observedAt: typeof s.observedAt === 'string' ? s.observedAt : null,
    shotsOnGoal: s.sog,
    totalShots: s.totalShots,
    corners: s.corners,
    dangerousAttacks: s.da,
    daEstimated: s.daEstimated,
    possession: s.dominantPoss,
    pressure: Math.round(s.pressure),
    homeGoals: s.homeGoals,
    awayGoals: s.awayGoals,
  };
}

export function shouldNotify(signal: HybridSignal): boolean {
  if (signal.tier === 'NORMAL') return false;
  if (signal.tier === 'SEMI' && signal.pressure < 65) return false;
  const key = `notified_${signal.matchId}`;
  if (localStorage.getItem(key)) return false;
  return true;
}

export function markNotified(matchId: string) {
  localStorage.setItem(`notified_${matchId}`, '1');
}

export function buildNotificationText(signal: HybridSignal): string {
  return `🔥 SINAL ANALÍTICO DETECTADO\n${signal.match} - ${signal.minute}'\n${signal.label}\n${signal.market}\nPressão: ${signal.pressure} | SoG: ${signal.shotsOnGoal} | Cantos: ${signal.corners}`;
}
