/**
 * HYBRID SIGNAL ENGINE
 * Classifica jogos LIVE em 3 níveis: SNIPER 🔥, SEMI ⚡, NORMAL 🔍
 * Camada ADICIONAL — não altera filtros existentes.
 */

// ═══════════════════════════════════════
// TYPES
// ═══════════════════════════════════════

export type HybridTier = 'SNIPER' | 'SEMI' | 'NORMAL';

export interface HybridSignal {
  matchId: string;
  match: string;
  league: string;
  minute: number;
  tier: HybridTier;
  label: string;           // "SNIPER 🔥" | "SEMI ⚡" | "NORMAL 🔍"
  confidence: 'alta' | 'média' | 'padrão';
  market: string;
  canExecute: boolean;
  executionReason: string;
  // stats
  shotsOnGoal: number;
  totalShots: number;
  corners: number;
  dangerousAttacks: number;
  /** True quando dangerousAttacks foi estimado via fallback (API retornou 0). */
  daEstimated: boolean;
  possession: number;      // dominant team possession
  pressure: number;
  homeGoals: number;
  awayGoals: number;
}

// ═══════════════════════════════════════
// RISK MANAGEMENT (shared state via localStorage)
// ═══════════════════════════════════════
const HYBRID_KEYS = {
  DAILY_COUNT: 'hybrid_daily_count',
  DAILY_DATE: 'hybrid_daily_date',
  CONSECUTIVE_LOSSES: 'hybrid_consecutive_losses',
  OPERATIONS: 'hybrid_operations',
};

function getTodayStr(): string {
  return new Date().toISOString().split('T')[0];
}

function getDailyCount(): number {
  const savedDate = localStorage.getItem(HYBRID_KEYS.DAILY_DATE);
  if (savedDate !== getTodayStr()) {
    localStorage.setItem(HYBRID_KEYS.DAILY_DATE, getTodayStr());
    localStorage.setItem(HYBRID_KEYS.DAILY_COUNT, '0');
    localStorage.setItem(HYBRID_KEYS.CONSECUTIVE_LOSSES, '0');
    return 0;
  }
  return Number(localStorage.getItem(HYBRID_KEYS.DAILY_COUNT) || '0');
}

function getConsecutiveLosses(): number {
  return Number(localStorage.getItem(HYBRID_KEYS.CONSECUTIVE_LOSSES) || '0');
}

export function isHybridBlocked(): { blocked: boolean; reason: string } {
  const losses = getConsecutiveLosses();
  const daily = getDailyCount();
  if (losses >= 2) return { blocked: true, reason: 'STOP: 2 losses consecutivos' };
  if (daily >= 5) return { blocked: true, reason: 'Máximo 5 entradas/dia atingido' };
  return { blocked: false, reason: '' };
}

// ═══════════════════════════════════════
// OPERATIONS PERSISTENCE
// ═══════════════════════════════════════
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

function loadOps(): HybridOperation[] {
  try {
    return JSON.parse(localStorage.getItem(HYBRID_KEYS.OPERATIONS) || '[]');
  } catch { return []; }
}

function saveOps(ops: HybridOperation[]) {
  localStorage.setItem(HYBRID_KEYS.OPERATIONS, JSON.stringify(ops.slice(-100)));
}

export function registerHybridEntry(signal: HybridSignal): HybridOperation | null {
  if (!signal.canExecute) return null;
  const op: HybridOperation = {
    id: `hybrid_${Date.now()}`,
    matchId: signal.matchId,
    match: signal.match,
    tier: signal.tier,
    minute: signal.minute,
    market: signal.market,
    pressure: signal.pressure,
    entryTime: Date.now(),
    result: 'PENDING',
  };
  const ops = loadOps();
  ops.push(op);
  saveOps(ops);
  const count = getDailyCount() + 1;
  localStorage.setItem(HYBRID_KEYS.DAILY_COUNT, String(count));
  localStorage.setItem(HYBRID_KEYS.DAILY_DATE, getTodayStr());
  return op;
}

export function resolveHybridOperation(opId: string, result: 'WIN' | 'LOSS' | 'CASHOUT', exitMinute?: number) {
  const ops = loadOps();
  const op = ops.find(o => o.id === opId);
  if (!op || op.result !== 'PENDING') return;
  op.result = result;
  op.exitMinute = exitMinute;
  saveOps(ops);
  if (result === 'LOSS') {
    const l = getConsecutiveLosses() + 1;
    localStorage.setItem(HYBRID_KEYS.CONSECUTIVE_LOSSES, String(l));
  } else if (result === 'WIN') {
    localStorage.setItem(HYBRID_KEYS.CONSECUTIVE_LOSSES, '0');
  }
}

export function getHybridPendingOps(): HybridOperation[] {
  return loadOps().filter(o => o.result === 'PENDING');
}

export function getAllHybridOps(): HybridOperation[] {
  return loadOps();
}

export interface HybridPerformance {
  totalEntries: number;
  wins: number;
  losses: number;
  cashouts: number;
  winrate: number;
  roi: number;
  last10: ('W' | 'L' | 'C')[];
  dayStatus: 'positivo' | 'negativo' | 'neutro';
  isBlocked: boolean;
  blockReason?: string;
  dailyCount: number;
  maxDaily: number;
}

export function getHybridPerformance(): HybridPerformance {
  const ops = loadOps();
  const resolved = ops.filter(o => o.result !== 'PENDING');
  const wins = resolved.filter(o => o.result === 'WIN').length;
  const losses = resolved.filter(o => o.result === 'LOSS').length;
  const cashouts = resolved.filter(o => o.result === 'CASHOUT').length;
  const total = resolved.length;
  const winrate = total > 0 ? Math.round((wins / total) * 100) : 0;
  const avgOdd = 1.35;
  const profit = wins * (avgOdd - 1) - losses * 1 - cashouts * 0.3;
  const roi = total > 0 ? Math.round((profit / total) * 100) : 0;
  const last10 = resolved.slice(-10).map(o =>
    o.result === 'WIN' ? 'W' as const : o.result === 'LOSS' ? 'L' as const : 'C' as const
  );
  const { blocked, reason } = isHybridBlocked();
  const todayOps = resolved.filter(o => new Date(o.entryTime).toISOString().split('T')[0] === getTodayStr());
  const dayProfit = todayOps.reduce((acc, o) => {
    if (o.result === 'WIN') return acc + (avgOdd - 1);
    if (o.result === 'LOSS') return acc - 1;
    return acc - 0.3;
  }, 0);

  return {
    totalEntries: total, wins, losses, cashouts, winrate, roi, last10,
    dayStatus: dayProfit > 0 ? 'positivo' : dayProfit < 0 ? 'negativo' : 'neutro',
    isBlocked: blocked, blockReason: reason || undefined,
    dailyCount: getDailyCount(), maxDaily: 5,
  };
}

// ═══════════════════════════════════════
// CLASSIFICATION ENGINE
// ═══════════════════════════════════════

/**
 * Snapshot history per match — guarda chutes/escanteios por minuto
 * para a Trava de Segurança (precisa de evento real nos últimos 10 min).
 */
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

/** Retorna true se houve ao menos 1 chute OU escanteio NOVO nos últimos 10 min. */
function hasRecentEvent(matchId: string, minute: number): boolean {
  const hist = SNAPSHOT_HISTORY[matchId];
  if (!hist || hist.length === 0) return false;
  const cutoff = minute - 10;
  // baseline = snapshot mais antigo dentro da janela (≤ cutoff)
  const baseline = [...hist].reverse().find(h => h.minute <= cutoff) || hist[0];
  const current = hist[hist.length - 1];
  const shotsDelta = current.totalShots - baseline.totalShots;
  const cornersDelta = current.corners - baseline.corners;
  return shotsDelta >= 1 || cornersDelta >= 1;
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

  // Fallback DA: quando API retorna 0, estima a partir de chutes e escanteios.
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

  // Atualiza histórico p/ trava de 10 min
  if (matchId && hasStats && minute > 0) recordSnapshot(matchId, minute, totalShots, corners);

  return { minute, homeGoals, awayGoals, sog, totalShots, corners, da, daEstimated, dominantPoss, pressure, homeTeam, awayTeam, matchId, league, hasStats };
}

function trySniper(s: ReturnType<typeof extractStats>): boolean {
  return (
    s.minute >= 5 && s.minute <= 30 &&
    s.homeGoals === 0 && s.awayGoals === 0 &&
    s.sog >= 2 &&
    s.dominantPoss >= 60 &&
    s.da >= 8 &&
    s.corners >= 2 &&
    s.pressure >= 70
  );
}

function trySemi(s: ReturnType<typeof extractStats>): boolean {
  const validScore = (s.homeGoals === 0 && s.awayGoals === 0) || (s.homeGoals + s.awayGoals === 1);
  return (
    s.minute >= 5 && s.minute <= 35 &&
    validScore &&
    s.sog >= 1 &&
    s.dominantPoss >= 55 &&
    s.da >= 6 &&
    s.corners >= 1 &&
    s.pressure >= 60
  );
}

function tryNormal(s: ReturnType<typeof extractStats>): boolean {
  return (
    s.minute <= 70 &&
    (s.sog >= 1 || s.da >= 5) &&
    s.pressure >= 55
  );
}

export function classifyHybridSignal(match: any): HybridSignal | null {
  // Aceita tanto MatchData (com isLive) quanto JSON cru da API-Sports (com fixture.status.short)
  const liveStatuses = ['1H', '2H', 'HT', 'ET', 'P', 'LIVE'];
  const status = String(match?.fixture?.status?.short || '').toUpperCase();
  const isLive = match?.isLive === true || liveStatuses.includes(status);
  if (!isLive) return null;

  const s = extractStats(match);
  if (!s.hasStats) return null;

  const { blocked } = isHybridBlocked();
  const ops = loadOps();
  const alreadyEntered = ops.some(o => o.matchId === s.matchId && o.result === 'PENDING');

  // 🛡️ TRAVA DE SEGURANÇA: precisa de ≥1 chute OU escanteio NOVO nos últimos 10 min.
  const recentEvent = hasRecentEvent(s.matchId, s.minute);

  let tier: HybridTier;
  let label: string;
  let confidence: HybridSignal['confidence'];
  let market: string;
  let canExecute: boolean;
  let executionReason: string;

  if (trySniper(s)) {
    if (!recentEvent && s.minute >= 15) return null;
    tier = 'SNIPER';
    label = 'SNIPER 🔥';
    confidence = 'alta';
    market = 'Over 0.5 HT';
    canExecute = !blocked && !alreadyEntered;
    executionReason = blocked ? isHybridBlocked().reason : alreadyEntered ? 'Já entrou neste jogo' : '✅ Pronto para entrada';
  } else if (trySemi(s)) {
    if (!recentEvent && s.minute >= 15) return null;
    tier = 'SEMI';
    label = 'SEMI ⚡';
    confidence = 'média';
    market = s.homeGoals + s.awayGoals === 0 ? 'Over 0.5' : 'Over 1.5';
    const inWindow = s.minute >= 10 && s.minute <= 30;
    canExecute = inWindow && !blocked && !alreadyEntered;
    executionReason = !inWindow ? `Fora da janela (10-30'), atual: ${s.minute}'`
      : blocked ? isHybridBlocked().reason
      : alreadyEntered ? 'Já entrou neste jogo' : '✅ Pronto para entrada';
  } else if (tryNormal(s)) {
    tier = 'NORMAL';
    label = 'NORMAL 🔍';
    confidence = 'padrão';
    market = 'Sugestão';
    canExecute = false;
    executionReason = 'Apenas sugestão — sem execução automática';
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
    canExecute,
    executionReason,
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

// ═══════════════════════════════════════
// NOTIFICATIONS (anti-spam via localStorage)
// ═══════════════════════════════════════

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
  return `🔥 OPORTUNIDADE DETECTADA\n${signal.match} - ${signal.minute}'\n${signal.label}\n${signal.market}\nPressão: ${signal.pressure} | SoG: ${signal.shotsOnGoal} | Cantos: ${signal.corners}`;
}
