/**
 * SNIPER MODE ENGINE
 * Camada avançada sobre o Scanner PRO para identificação de oportunidades
 * de alta precisão em jogos ao vivo.
 */

// ═══════════════════════════════════════
// TYPES
// ═══════════════════════════════════════

export interface SniperSignal {
  matchId: string;
  match: string;
  league: string;
  minute: number;
  da5min: number;       // DA últimos 5 min estimado
  appm: number;         // Ataques perigosos por minuto
  shotsOnGoal: number;
  totalShots: number;
  corners: number;
  recentCorner: boolean;
  pressure: number;
  isSniper: boolean;
  signal: string;
  market: string;
  canExecute: boolean;  // Passes execution rules
  executionReason: string;
}

export interface SniperOperation {
  id: string;
  matchId: string;
  match: string;
  minute: number;
  market: string;
  stats: { da: number; appm: number; sog: number; corners: number; pressure: number };
  entryTime: number;
  result: 'PENDING' | 'WIN' | 'LOSS' | 'CASHOUT';
  exitMinute?: number;
}

export interface SniperPerformance {
  totalEntries: number;
  wins: number;
  losses: number;
  cashouts: number;
  winrate: number;
  roi: number;
  last10: ('W' | 'L' | 'C')[];
  consecutiveLosses: number;
  dayStatus: 'positivo' | 'negativo' | 'neutro';
  isBlocked: boolean;
  blockReason?: string;
  adjustedThresholds: {
    pressureMin: number;
    cornersMin: number;
    appmMin: number;
  };
}

// ═══════════════════════════════════════
// STORAGE KEYS
// ═══════════════════════════════════════
const STORAGE_KEYS = {
  OPERATIONS: 'sniper_operations',
  DAILY_COUNT: 'sniper_daily_count',
  DAILY_DATE: 'sniper_daily_date',
  CONSECUTIVE_LOSSES: 'sniper_consecutive_losses',
};

// ═══════════════════════════════════════
// PERSISTENCE
// ═══════════════════════════════════════
function loadOperations(): SniperOperation[] {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.OPERATIONS);
    return data ? JSON.parse(data) : [];
  } catch { return []; }
}

function saveOperations(ops: SniperOperation[]) {
  // Keep last 100 operations
  const trimmed = ops.slice(-100);
  localStorage.setItem(STORAGE_KEYS.OPERATIONS, JSON.stringify(trimmed));
}

function getTodayStr(): string {
  return new Date().toISOString().split('T')[0];
}

function getDailyCount(): number {
  const savedDate = localStorage.getItem(STORAGE_KEYS.DAILY_DATE);
  if (savedDate !== getTodayStr()) {
    localStorage.setItem(STORAGE_KEYS.DAILY_DATE, getTodayStr());
    localStorage.setItem(STORAGE_KEYS.DAILY_COUNT, '0');
    localStorage.setItem(STORAGE_KEYS.CONSECUTIVE_LOSSES, '0');
    return 0;
  }
  return Number(localStorage.getItem(STORAGE_KEYS.DAILY_COUNT) || '0');
}

function incrementDailyCount() {
  const count = getDailyCount() + 1;
  localStorage.setItem(STORAGE_KEYS.DAILY_COUNT, String(count));
  localStorage.setItem(STORAGE_KEYS.DAILY_DATE, getTodayStr());
}

function getConsecutiveLosses(): number {
  return Number(localStorage.getItem(STORAGE_KEYS.CONSECUTIVE_LOSSES) || '0');
}

function setConsecutiveLosses(n: number) {
  localStorage.setItem(STORAGE_KEYS.CONSECUTIVE_LOSSES, String(n));
}

// ═══════════════════════════════════════
// AUTO-ADJUST THRESHOLDS
// ═══════════════════════════════════════
export function getAdjustedThresholds(): { pressureMin: number; cornersMin: number; appmMin: number } {
  const ops = loadOperations();
  const recent = ops.filter(o => o.result !== 'PENDING').slice(-20);
  
  if (recent.length < 5) {
    return { pressureMin: 70, cornersMin: 2, appmMin: 0.8 };
  }

  const wins = recent.filter(o => o.result === 'WIN').length;
  const winrate = wins / recent.length;

  if (winrate < 0.55) {
    // Increase requirements
    return { pressureMin: 75, cornersMin: 3, appmMin: 0.8 };
  }
  if (winrate > 0.70) {
    // Relax slightly
    return { pressureMin: 70, cornersMin: 2, appmMin: 0.7 };
  }

  return { pressureMin: 70, cornersMin: 2, appmMin: 0.8 };
}

// ═══════════════════════════════════════
// SNIPER FILTER (LIVE ONLY)
// ═══════════════════════════════════════
function safeDangerousAttacks(stats: any): number {
  if (stats?.dangerousAttacks && stats.dangerousAttacks > 0) return stats.dangerousAttacks;
  return ((stats?.totalShots || stats?.shotsOnGoal || 0) * 1.5) + ((stats?.corners || 0) * 2);
}

export function analyzeSniperSignal(match: any): SniperSignal | null {
  if (!match.isLive) return null;

  const minute = match.minute || match.fixture?.status?.elapsed || 0;
  
  // Must be 5-30 min (1st half)
  if (minute < 5 || minute > 30) return null;

  // Must be 0x0
  const homeGoals = match.goals?.home ?? match.liveScore?.home ?? 0;
  const awayGoals = match.goals?.away ?? match.liveScore?.away ?? 0;
  if (homeGoals !== 0 || awayGoals !== 0) return null;

  const lH = match.stats?.home || {};
  const lA = match.stats?.away || {};

  // Ignore matches without stats
  if (!lH.shotsOnGoal && !lA.shotsOnGoal && !lH.dangerousAttacks && !lA.dangerousAttacks) {
    return null;
  }

  const hDA = safeDangerousAttacks(lH);
  const aDA = safeDangerousAttacks(lA);
  const totalDA = hDA + aDA;

  // APPM = Ataques Perigosos Por Minuto
  const appm = minute > 0 ? totalDA / minute : 0;

  const totalSoG = (lH.shotsOnGoal || 0) + (lA.shotsOnGoal || 0);
  const totalShots = (lH.totalShots || 0) + (lA.totalShots || 0) + totalSoG;
  const totalCorners = (lH.corners || 0) + (lA.corners || 0);
  
  // Estimate recent corner (simplified: if corners > 0 and minute > 5)
  const recentCorner = totalCorners >= 1 && minute >= 5;

  // Pressure calculation
  const pressure = Math.min(100, Math.max(0,
    (totalDA * 3 + totalCorners * 5 + totalSoG * 10) / 5
  ));

  const thresholds = getAdjustedThresholds();

  // SNIPER criteria (last 5 min DA estimated from total rate)
  const da5min = Math.round(appm * 5 * 10) / 10;
  const isSniperDA = da5min >= 3;
  const isSniperAPPM = appm >= thresholds.appmMin;
  const isSniperSoG = totalSoG >= 1;
  const isSniperShots = totalShots >= 2;
  const isSniperCorners = totalCorners >= thresholds.cornersMin;
  const isSniperRecentCorner = recentCorner;

  const isSniper = isSniperDA && isSniperAPPM && isSniperSoG && isSniperShots && isSniperCorners && isSniperRecentCorner;

  // Execution checks
  const canTimingExecute = minute >= 10 && minute <= 25;
  const canPressureExecute = pressure >= thresholds.pressureMin;
  const canCornersExecute = totalCorners >= thresholds.cornersMin;
  const canSoGExecute = totalSoG >= 1;

  const dailyCount = getDailyCount();
  const consecutiveLosses = getConsecutiveLosses();
  const maxEntries = 3;
  const isBlocked = consecutiveLosses >= 2 || dailyCount >= maxEntries;

  // Check if already entered this match
  const ops = loadOperations();
  const alreadyEntered = ops.some(o => o.matchId === String(match.id || match.fixture?.id) && o.result !== 'PENDING');

  let canExecute = isSniper && canTimingExecute && canPressureExecute && canCornersExecute && canSoGExecute && !isBlocked && !alreadyEntered;
  let executionReason = '';
  
  if (!isSniper) executionReason = 'Critérios SNIPER não atendidos';
  else if (isBlocked) executionReason = consecutiveLosses >= 2 ? 'STOP: 2 losses consecutivos' : `Máximo ${maxEntries} entradas/dia atingido`;
  else if (alreadyEntered) executionReason = 'Já entrou neste jogo';
  else if (!canTimingExecute) executionReason = `Fora da janela (10-25 min), atual: ${minute}'`;
  else if (!canPressureExecute) executionReason = `Pressure ${Math.round(pressure)} < ${thresholds.pressureMin}`;
  else if (!canCornersExecute) executionReason = `Escanteios ${totalCorners} < ${thresholds.cornersMin}`;
  else if (!canSoGExecute) executionReason = 'Sem chute no gol recente';
  else executionReason = '✅ Pronto para entrada';

  const homeTeam = match.teams?.home?.name || match.homeTeam || 'Casa';
  const awayTeam = match.teams?.away?.name || match.awayTeam || 'Fora';

  return {
    matchId: String(match.id || match.fixture?.id),
    match: `${homeTeam} vs ${awayTeam}`,
    league: match.league?.name || match.league || '',
    minute,
    da5min,
    appm: Math.round(appm * 100) / 100,
    shotsOnGoal: totalSoG,
    totalShots,
    corners: totalCorners,
    recentCorner,
    pressure: Math.round(pressure),
    isSniper,
    signal: isSniper ? 'SNIPER 🔥' : 'Oportunidade Normal',
    market: 'Over 0.5 HT',
    canExecute,
    executionReason,
  };
}

// ═══════════════════════════════════════
// REGISTER OPERATION
// ═══════════════════════════════════════
export function registerSniperEntry(signal: SniperSignal): SniperOperation | null {
  if (!signal.canExecute) return null;

  const op: SniperOperation = {
    id: `sniper_${Date.now()}`,
    matchId: signal.matchId,
    match: signal.match,
    minute: signal.minute,
    market: signal.market,
    stats: {
      da: signal.da5min,
      appm: signal.appm,
      sog: signal.shotsOnGoal,
      corners: signal.corners,
      pressure: signal.pressure,
    },
    entryTime: Date.now(),
    result: 'PENDING',
  };

  const ops = loadOperations();
  ops.push(op);
  saveOperations(ops);
  incrementDailyCount();

  return op;
}

// ═══════════════════════════════════════
// RESOLVE OPERATION
// ═══════════════════════════════════════
export function resolveSniperOperation(operationId: string, result: 'WIN' | 'LOSS' | 'CASHOUT', exitMinute?: number) {
  const ops = loadOperations();
  const op = ops.find(o => o.id === operationId);
  if (!op || op.result !== 'PENDING') return;

  op.result = result;
  op.exitMinute = exitMinute;
  saveOperations(ops);

  if (result === 'LOSS') {
    setConsecutiveLosses(getConsecutiveLosses() + 1);
  } else if (result === 'WIN') {
    setConsecutiveLosses(0);
  }
}

// ═══════════════════════════════════════
// PERFORMANCE DASHBOARD
// ═══════════════════════════════════════
export function getSniperPerformance(): SniperPerformance {
  const ops = loadOperations();
  const resolved = ops.filter(o => o.result !== 'PENDING');
  const wins = resolved.filter(o => o.result === 'WIN').length;
  const losses = resolved.filter(o => o.result === 'LOSS').length;
  const cashouts = resolved.filter(o => o.result === 'CASHOUT').length;
  const total = resolved.length;
  const winrate = total > 0 ? Math.round((wins / total) * 100) : 0;

  // ROI estimation (1% stake, avg odd 1.35 for Over 0.5 HT)
  const avgOdd = 1.35;
  const profit = wins * (avgOdd - 1) - losses * 1 - cashouts * 0.3;
  const roi = total > 0 ? Math.round((profit / total) * 100) : 0;

  const last10 = resolved.slice(-10).map(o => 
    o.result === 'WIN' ? 'W' as const : o.result === 'LOSS' ? 'L' as const : 'C' as const
  );

  const consecutiveLosses = getConsecutiveLosses();
  const dailyCount = getDailyCount();
  const isBlocked = consecutiveLosses >= 2 || dailyCount >= 3;
  const blockReason = consecutiveLosses >= 2 
    ? 'STOP: 2 losses consecutivos hoje' 
    : dailyCount >= 3 ? 'Máximo 3 entradas/dia' : undefined;

  const dayProfit = resolved
    .filter(o => {
      const d = new Date(o.entryTime).toISOString().split('T')[0];
      return d === getTodayStr();
    })
    .reduce((acc, o) => {
      if (o.result === 'WIN') return acc + (avgOdd - 1);
      if (o.result === 'LOSS') return acc - 1;
      return acc - 0.3;
    }, 0);

  return {
    totalEntries: total,
    wins,
    losses,
    cashouts,
    winrate,
    roi,
    last10,
    consecutiveLosses,
    dayStatus: dayProfit > 0 ? 'positivo' : dayProfit < 0 ? 'negativo' : 'neutro',
    isBlocked,
    blockReason,
    adjustedThresholds: getAdjustedThresholds(),
  };
}

export function getPendingOperations(): SniperOperation[] {
  return loadOperations().filter(o => o.result === 'PENDING');
}

export function getAllOperations(): SniperOperation[] {
  return loadOperations();
}
