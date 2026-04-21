import { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { Loader2, RefreshCw, Zap, TrendingUp, AlertTriangle, Volume2, VolumeX, Target, ShieldCheck, Flame, BarChart3, Crosshair, Star, Eye, Bug } from 'lucide-react';
import SniperPanel from '@/components/SniperPanel';
import AuditPanel from '@/components/AuditPanel';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchLiveMatches } from '@/services/footballApi';
import {
  analyzeLivePressure,
  generateLiveStrategy,
  recordPISnapshot,
  type PressureData,
  type PISnapshot,
  type LiveStrategy,
} from '@/lib/pressureEngine';
import {
  normalizePressure,
  calculateAPWindows,
  calculatePericulosity,
  detectImminentGoal,
  calculateLiveOddsDeviation,
  projectCornersByPeriod,
  detectFavoriteLosing,
  type AttackPressureWindows,
  type PericulosityData,
  type ImminentGoalData,
  type OddsDeviation,
  type SmartFilterResult,
} from '@/lib/eliteMetrics';
import CornerTimeline from '@/components/CornerTimeline';
import MomentumChart from '@/components/MomentumChart';
import OverGoalsPanel from '@/components/OverGoalsPanel';
import { calculateHtFtStrategy, type HtFtPrediction } from '@/lib/htftEngine';

type DataStatus = 'valid' | 'awaiting_data' | 'awaiting_api' | 'blocked' | 'error';

interface MatchAnalysis {
  dataStatus: DataStatus;
  statusMessage: string;
  pressure: PressureData;
  history: PISnapshot[];
  strategies: LiveStrategy[];
  apWindows: AttackPressureWindows;
  periculosity: PericulosityData;
  imminentHome: ImminentGoalData;
  imminentAway: ImminentGoalData;
  oddsDeviation: OddsDeviation;
  smartFilter: SmartFilterResult | null;
  htft: HtFtPrediction[];
  /** Composite score used for ranking */
  scannerScore: number;
}

const DEFAULT_PRESSURE: PressureData = {
  homePI: 0, awayPI: 0, homeSignal: '🟢 Estável', awaySignal: '🟢 Estável',
  homePressureShare: 50, awayPressureShare: 50, dominance: 'balanced',
};
const DEFAULT_AP: AttackPressureWindows = { ap5Home: 0, ap5Away: 0, ap10Home: 0, ap10Away: 0 };
const DEFAULT_PERIC: PericulosityData = { home: 0, away: 0, homeLabel: '🟢 BAIXO', awayLabel: '🟢 BAIXO' };
const DEFAULT_IMMINENT: ImminentGoalData = { score: 0, isTriggered: false, reason: 'Sem dados' };
const DEFAULT_ODDS: OddsDeviation = {
  homeWinPoisson: 33, drawPoisson: 34, awayWinPoisson: 33,
  homeImpliedOdd: 3.0, drawImpliedOdd: 3.0, awayImpliedOdd: 3.0,
};

const BLOCKED_RESULT: MatchAnalysis = {
  dataStatus: 'blocked', statusMessage: '',
  pressure: DEFAULT_PRESSURE, history: [], strategies: [],
  apWindows: DEFAULT_AP, periculosity: DEFAULT_PERIC,
  imminentHome: DEFAULT_IMMINENT, imminentAway: DEFAULT_IMMINENT,
  oddsDeviation: DEFAULT_ODDS, smartFilter: null, htft: [], scannerScore: 0,
};

const MAX_SCANNER_MATCHES = 10;

/** Validate live data integrity before running any analysis */
function validateLiveData(
  homeStats: any, awayStats: any, minute: number
): { status: DataStatus; message: string } {
  if (!homeStats && !awayStats) {
    return { status: 'awaiting_api', message: 'AGUARDANDO DADOS DA API' };
  }

  const h = homeStats || {};
  const a = awayStats || {};

  // Apply DA fallback (API often returns 0 for dangerousAttacks)
  const rawDA = (h.dangerousAttacks || 0) + (a.dangerousAttacks || 0);
  const totalShots = (h.totalShots || 0) + (a.totalShots || 0);
  const totalCorners = (h.corners || 0) + (a.corners || 0);
  const totalDA = rawDA > 0 ? rawDA : Math.round(totalShots * 1.5 + totalCorners * 2);
  const totalShotsOnGoal = (h.shotsOnGoal || 0) + (a.shotsOnGoal || 0);
  const homePoss = Number(h.possession || 0);
  const awayPoss = Number(a.possession || 0);
  const hasPossession = (homePoss > 0 && homePoss !== 50) || (awayPoss > 0 && awayPoss !== 50);

  const allZero = totalDA === 0 && totalShots === 0 && totalShotsOnGoal === 0 && totalCorners === 0 && !hasPossession;

  if (minute < 5 || allZero) {
    return { status: 'awaiting_data', message: 'AGUARDANDO DADOS REAIS' };
  }

  // Relaxed entry filter: any meaningful stat qualifies
  const passesEntryFilter = totalDA >= 3 || totalShotsOnGoal >= 1 || totalShots >= 2 || totalCorners >= 1 || hasPossession;
  if (!passesEntryFilter) {
    return { status: 'blocked', message: 'SEM VALOR — Pressão insuficiente' };
  }

  return { status: 'valid', message: '' };
}

/** Compute composite scanner score for ranking */
function computeScannerScore(
  homeStats: any,
  awayStats: any,
  pressure: PressureData,
  apWindows: AttackPressureWindows,
  periculosity: PericulosityData,
  imminentHome: ImminentGoalData,
  imminentAway: ImminentGoalData,
  minute: number,
): number {
  const h = homeStats || {};
  const a = awayStats || {};
  const safeMin = Math.max(minute, 1);

  // Apply DA fallback
  const rawHDA = h.dangerousAttacks || 0;
  const rawADA = a.dangerousAttacks || 0;
  const hDA = rawHDA > 0 ? rawHDA : Math.round(((h.totalShots || 0) * 1.5) + ((h.corners || 0) * 2));
  const aDA = rawADA > 0 ? rawADA : Math.round(((a.totalShots || 0) * 1.5) + ((a.corners || 0) * 2));
  const totalDA = hDA + aDA;
  const totalSoG = (h.shotsOnGoal || 0) + (a.shotsOnGoal || 0);
  const totalCorners = (h.corners || 0) + (a.corners || 0);
  const maxDA = Math.max(hDA, aDA);
  const minDA = Math.min(hDA, aDA);
  const dominanceDiff = maxDA - minDA;

  // Offensive frequency (per minute)
  const offFreq = totalDA / safeMin;

  // Composite: weighted sum
  const score =
    (totalDA * 3) +
    (totalSoG * 5) +
    (totalCorners * 1.5) +
    (offFreq * 10) +
    (dominanceDiff * 2) +
    (Math.max(apWindows.ap5Home, apWindows.ap5Away) * 0.5) +
    (Math.max(periculosity.home, periculosity.away) * 0.3) +
    (Math.max(imminentHome.score, imminentAway.score) * 0.2) +
    (Math.max(pressure.homePI, pressure.awayPI) * 0.3);

  return Math.round(score * 10) / 10;
}

function safeAnalyze(match: any, statsMap: Record<string, any>): MatchAnalysis {
  const id = match?.fixture?.id || match?.id;
  const stats = statsMap[id];
  const minute = match?.fixture?.status?.elapsed || 0;
  const homeGoals = match?.goals?.home ?? 0;
  const awayGoals = match?.goals?.away ?? 0;
  const homeName = match?.teams?.home?.name || 'Casa';
  const awayName = match?.teams?.away?.name || 'Fora';
  const homeStats = stats?.home || null;
  const awayStats = stats?.away || null;

  const validation = validateLiveData(homeStats, awayStats, minute);
  if (validation.status !== 'valid') {
    return { ...BLOCKED_RESULT, dataStatus: validation.status, statusMessage: validation.message };
  }

  let pressure = DEFAULT_PRESSURE;
  let history: PISnapshot[] = [];
  let strategies: LiveStrategy[] = [];
  let apWindows = DEFAULT_AP;
  let periculosity = DEFAULT_PERIC;
  let imminentHome = DEFAULT_IMMINENT;
  let imminentAway = DEFAULT_IMMINENT;
  let oddsDeviation = DEFAULT_ODDS;
  let smartFilter: SmartFilterResult | null = null;

  try { pressure = analyzeLivePressure(homeStats, awayStats, minute); } catch (e) { console.error('Pressure error:', e); }
  try { history = recordPISnapshot(id, pressure.homePI, pressure.awayPI, minute); } catch (e) { console.error('PI history error:', e); }
  try { strategies = generateLiveStrategy(homeStats, awayStats, minute, homeGoals, awayGoals, homeName, awayName); } catch (e) { console.error('Strategy error:', e); }
  try { apWindows = calculateAPWindows(history, minute); } catch (e) { console.error('AP error:', e); }
  try { periculosity = calculatePericulosity(homeStats, awayStats, minute); } catch (e) { console.error('Periculosity error:', e); }
  try { imminentHome = detectImminentGoal(homeStats, minute, apWindows.ap5Home); } catch (e) { console.error('Imminent home error:', e); }
  try { imminentAway = detectImminentGoal(awayStats, minute, apWindows.ap5Away); } catch (e) { console.error('Imminent away error:', e); }
  try { oddsDeviation = calculateLiveOddsDeviation(homeStats, awayStats, homeGoals, awayGoals, minute); } catch (e) { console.error('Odds error:', e); }
  try {
    const homePoss = homeStats?.possession || 50;
    const awayPoss = awayStats?.possession || 50;
    smartFilter = detectFavoriteLosing(id, homeName, awayName, homeGoals, awayGoals, apWindows.ap5Home, apWindows.ap5Away, homePoss, awayPoss);
  } catch (e) { console.error('Smart filter error:', e); }

  let htft: HtFtPrediction[] = [];
  try {
    htft = calculateHtFtStrategy(homeStats, awayStats, homeGoals, awayGoals, minute, homeName, awayName, apWindows.ap5Home, apWindows.ap5Away);
  } catch (e) { console.error('HT/FT error:', e); }

  // Post-analysis sanity checks
  if (minute <= 20) {
    if (oddsDeviation.drawPoisson >= 90 || oddsDeviation.homeWinPoisson >= 95 || oddsDeviation.awayWinPoisson >= 95) {
      return { ...BLOCKED_RESULT, dataStatus: 'error', statusMessage: 'ERRO NO SISTEMA LIVE — Percentuais irreais detectados' };
    }
  }

  const totalRealShots = (homeStats?.shotsOnGoal || 0) + (awayStats?.shotsOnGoal || 0);
  if ((imminentHome.isTriggered || imminentAway.isTriggered) && totalRealShots === 0) {
    imminentHome = DEFAULT_IMMINENT;
    imminentAway = DEFAULT_IMMINENT;
  }

  const scannerScore = computeScannerScore(homeStats, awayStats, pressure, apWindows, periculosity, imminentHome, imminentAway, minute);

  return { dataStatus: 'valid', statusMessage: '', pressure, history, strategies, apWindows, periculosity, imminentHome, imminentAway, oddsDeviation, smartFilter, htft, scannerScore };
}

/** Determine alert level for a match */
function getScannerAlertLevel(analysis: MatchAnalysis, homeStats: any, awayStats: any): 'maximo' | 'observar' | null {
  if (analysis.dataStatus !== 'valid') return null;
  const h = homeStats || {};
  const a = awayStats || {};
  const rawHomeDA = h.dangerousAttacks || 0;
  const rawAwayDA = a.dangerousAttacks || 0;
  const homeDA = rawHomeDA > 0 ? rawHomeDA : Math.round(((h.totalShots || 0) * 1.5) + ((h.corners || 0) * 2));
  const awayDA = rawAwayDA > 0 ? rawAwayDA : Math.round(((a.totalShots || 0) * 1.5) + ((a.corners || 0) * 2));
  const maxDA = Math.max(homeDA, awayDA);
  const totalDA = homeDA + awayDA;
  const diffPct = totalDA > 0 ? (maxDA / totalDA) * 100 : 0;

  const hasImminent = analysis.imminentHome.isTriggered || analysis.imminentAway.isTriggered;
  const hasContinuousPressure = Math.max(analysis.apWindows.ap5Home, analysis.apWindows.ap5Away) > 40;

  // ALERTA MÁXIMO: DA ≥ 8, diff ≥ 40%, continuous pressure
  if (maxDA >= 8 && diffPct >= 60 && hasContinuousPressure) return 'maximo';
  if (hasImminent) return 'maximo';

  return 'observar';
}

const Live = () => {
  const [favorites, setFavorites] = useState<number[]>(() => {
    try { return JSON.parse(localStorage.getItem('liveMatchFavorites') || '[]'); } catch { return []; }
  });
  const [showAudit, setShowAudit] = useState(false);

  useEffect(() => {
    localStorage.setItem('liveMatchFavorites', JSON.stringify(favorites));
  }, [favorites]);

  const toggleFavorite = useCallback((id: number) => {
    setFavorites(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }, []);

  const {
    data: matches = [],
    isLoading,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['live-matches'],
    queryFn: () => fetchLiveMatches(),
    refetchInterval: 60000,
    staleTime: 55000,
    refetchOnWindowFocus: true,
  });

  // Refetch when app returns from background (mobile)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        refetch();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [refetch]);

  const statsMap = useMemo(() => {
    const result: Record<string, any> = {};
    for (const match of matches as any[]) {
      const id = match?.fixture?.id || match?.id;
      if (!id) continue;
      const s = match?.stats;
      const isFake = (st: any) => {
        if (!st) return true;
        // Only fake if literally ALL metrics are zero/null — real games always have at least 1 non-zero stat
        const p = Number(st.possession || 0);
        const hasAnyShots = (st.shotsOnGoal || 0) > 0 || (st.totalShots || 0) > 0;
        const hasAnyDA = (st.dangerousAttacks || 0) > 0;
        const hasCorners = (st.corners || 0) > 0;
        const hasRealPoss = p > 0 && p !== 50;
        return !hasAnyShots && !hasAnyDA && !hasCorners && !hasRealPoss;
      };
      result[id] = {
        home: isFake(s?.home) ? null : s.home,
        away: isFake(s?.away) ? null : s.away,
      };
    }
    return result;
  }, [matches]);

  const analysisMap = useMemo(() => {
    const map: Record<string, MatchAnalysis> = {};
    const matchList = matches as any[];
    // Pre-filter: skip matches with no stats to avoid expensive analysis
    for (const match of matchList) {
      const id = match?.fixture?.id || match?.id;
      if (!id) continue;
      const stats = statsMap[id];
      // Skip analysis entirely if both sides have no stats
      if (!stats?.home && !stats?.away) {
        map[id] = { ...BLOCKED_RESULT, dataStatus: 'awaiting_api', statusMessage: 'AGUARDANDO DADOS DA API' };
        continue;
      }
      map[id] = safeAnalyze(match, statsMap);
    }
    return map;
  }, [matches, statsMap]);

  // ═══ AUDIT ENTRIES ═══
  const auditEntries = useMemo(() => {
    return (matches as any[]).map((match) => {
      const id = match?.fixture?.id || match?.id;
      const rawStats = match?.stats;
      const isFakeCheck = (st: any) => {
        if (!st) return true;
        const p = Number(st.possession || 0);
        const hasAnyShots = (st.shotsOnGoal || 0) > 0 || (st.totalShots || 0) > 0;
        const hasAnyDA = (st.dangerousAttacks || 0) > 0;
        const hasCorners = (st.corners || 0) > 0;
        const hasRealPoss = p > 0 && p !== 50;
        return !hasAnyShots && !hasAnyDA && !hasCorners && !hasRealPoss;
      };
      const homeFake = isFakeCheck(rawStats?.home);
      const awayFake = isFakeCheck(rawStats?.away);
      const analysis = analysisMap[id] || BLOCKED_RESULT;

      return {
        id,
        homeName: match?.teams?.home?.name || 'Casa',
        awayName: match?.teams?.away?.name || 'Fora',
        league: match?.league || '',
        minute: match?.fixture?.status?.elapsed || 0,
        homeGoals: match?.goals?.home ?? 0,
        awayGoals: match?.goals?.away ?? 0,
        rawHome: rawStats?.home || null,
        rawAway: rawStats?.away || null,
        homeFake,
        awayFake,
        filteredHome: statsMap[id]?.home || null,
        filteredAway: statsMap[id]?.away || null,
        dataStatus: analysis.dataStatus,
        statusMessage: analysis.statusMessage,
        scannerScore: analysis.scannerScore,
      };
    });
  }, [matches, statsMap, analysisMap]);


  const [soundEnabled, setSoundEnabled] = useState(true);
  const alertedRef = useRef<Set<string>>(new Set());

  const playAlertSound = useCallback((freq: number = 880, duration: number = 0.5) => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + duration);
    } catch (e) { /* audio unavailable */ }
  }, []);

  useEffect(() => {
    if (!soundEnabled) return;
    for (const [id, analysis] of Object.entries(analysisMap)) {
      const homeImKey = `${id}_imminent_home`;
      const awayImKey = `${id}_imminent_away`;
      if (analysis.imminentHome.isTriggered && !alertedRef.current.has(homeImKey)) {
        alertedRef.current.add(homeImKey);
        playAlertSound(1047, 0.8);
      }
      if (analysis.imminentAway.isTriggered && !alertedRef.current.has(awayImKey)) {
        alertedRef.current.add(awayImKey);
        playAlertSound(1047, 0.8);
      }
      if (!analysis.imminentHome.isTriggered) alertedRef.current.delete(homeImKey);
      if (!analysis.imminentAway.isTriggered) alertedRef.current.delete(awayImKey);

      const homeKey = `${id}_home`;
      const awayKey = `${id}_away`;
      if (analysis.pressure.homePI >= 70 && !alertedRef.current.has(homeKey)) {
        alertedRef.current.add(homeKey);
        playAlertSound(880, 0.5);
      }
      if (analysis.pressure.awayPI >= 70 && !alertedRef.current.has(awayKey)) {
        alertedRef.current.add(awayKey);
        playAlertSound(880, 0.5);
      }
      if (analysis.pressure.homePI < 60) alertedRef.current.delete(homeKey);
      if (analysis.pressure.awayPI < 60) alertedRef.current.delete(awayKey);
    }
  }, [analysisMap, soundEnabled, playAlertSound]);

  const signalStyles: Record<string, { bg: string; border: string; icon: string }> = {
    entry: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', icon: '🟢' },
    wait: { bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', icon: '🟡' },
    caution: { bg: 'bg-red-500/10', border: 'border-red-500/30', icon: '🔴' },
  };

  // ═══ SCANNER: filter valid games, rank by score, limit to top 5 ═══
  const rankedMatches = useMemo(() => {
    const validEntries: { match: any; analysis: MatchAnalysis; id: any }[] = [];
    for (const match of matches as any[]) {
      const id = match?.fixture?.id || match?.id;
      const analysis = analysisMap[id];
      if (!analysis || analysis.dataStatus !== 'valid') continue;
      validEntries.push({ match, analysis, id });
    }

    // Sort by scannerScore descending
    validEntries.sort((a, b) => b.analysis.scannerScore - a.analysis.scannerScore);

    // Limit to top MAX_SCANNER_MATCHES
    return validEntries.slice(0, MAX_SCANNER_MATCHES);
  }, [matches, analysisMap]);

  const totalLive = (matches as any[]).length;
  const totalScanned = Object.values(analysisMap).filter(a => a.dataStatus === 'valid').length;
  const alertCount = rankedMatches.filter(({ analysis, id }) => {
    const stats = statsMap[id];
    return getScannerAlertLevel(analysis, stats?.home, stats?.away) === 'maximo';
  }).length;

  return (
    <div className="min-h-screen bg-[#0D1117] text-[#e6edf3]">
      {/* ═══ CONTROLS BAR ═══ */}
      <div className="container max-w-3xl mx-auto px-4 pt-4 pb-2 flex items-center justify-between">
        <h1 className="font-bold text-lg tracking-tight text-white">SCANNER PRO</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`p-2 rounded-lg transition-colors border ${soundEnabled ? 'bg-orange-500/20 text-orange-400 border-orange-500/30' : 'bg-[#161B22] text-gray-500 border-[#30363D]'}`}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setShowAudit(!showAudit)}
            className={`p-2 rounded-lg transition-colors border ${showAudit ? 'bg-purple-500/20 text-purple-400 border-purple-500/30' : 'bg-[#161B22] text-gray-500 border-[#30363D]'}`}
            title="Auditoria / Debug"
          >
            <Bug className="w-4 h-4" />
          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 text-xs bg-[#161B22] border border-[#30363D] px-3 py-2 rounded-lg hover:bg-[#1c2333] transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin text-orange-500' : 'text-gray-400'}`} />
          </button>
          <Link
            to="/favorites"
            className="flex items-center gap-1 text-xs bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 px-3 py-2 rounded-lg hover:bg-yellow-500/20 transition-colors"
          >
            <Star className="w-4 h-4 fill-yellow-400" />
            {favorites.length > 0 && <span className="font-bold">{favorites.length}</span>}
          </Link>
        </div>
      </div>

      {/* ═══ SCANNER STATUS BAR ═══ */}
      <div className="container max-w-3xl mx-auto px-4 pt-3">
        <div className="bg-[#161B22] border border-[#30363D] rounded-xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="text-[10px] font-bold text-emerald-400 uppercase">Scanner Ativo</span>
            </div>
          </div>
          <div className="flex items-center gap-4 text-[10px] text-gray-400">
            <span>🔍 <b className="text-gray-300">{totalLive}</b> ao vivo</span>
            <span>✅ <b className="text-emerald-400">{totalScanned}</b> com dados</span>
            <span>📊 <b className="text-orange-400">{rankedMatches.length}</b> no radar</span>
            {alertCount > 0 && <span className="text-red-400 font-bold animate-pulse">🚨 {alertCount} alerta{alertCount > 1 ? 's' : ''}</span>}
          </div>
        </div>
      </div>

      <main className="container max-w-3xl mx-auto px-4 py-4 space-y-5">
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
            <p className="text-sm text-gray-400">Escaneando jogos ao vivo...</p>
          </div>
        )}

        {!isLoading && totalLive === 0 && (
          <div className="text-center py-20">
            <AlertTriangle className="w-10 h-10 text-yellow-500 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">Nenhum jogo ao vivo no momento.</p>
            <p className="text-gray-500 text-xs mt-1">O scanner detectará jogos automaticamente.</p>
          </div>
        )}

        {/* SNIPER MODE PANEL */}
        {!isLoading && matches.length > 0 && (
          <div className="mt-4">
            <SniperPanel matches={matches as any} />
          </div>
        )}

        {!isLoading && totalLive > 0 && rankedMatches.length === 0 && (
          <div className="text-center py-16">
            <Eye className="w-10 h-10 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400 text-sm font-bold">NENHUMA OPORTUNIDADE DETECTADA</p>
            <p className="text-gray-500 text-xs mt-2">{totalLive} jogos monitorados — aguardando dados de estatísticas.</p>
            <p className="text-gray-600 text-[10px] mt-1">Filtro: DA ≥ 3 ou Chutes ≥ 1 ou Escanteios ≥ 1</p>
          </div>
        )}

        {rankedMatches.map(({ match, analysis, id }, rankIndex) => {
          const { pressure, history, strategies, apWindows, periculosity, imminentHome, imminentAway, oddsDeviation, smartFilter, htft, scannerScore } = analysis;
          const homeName = match?.teams?.home?.name || 'Casa';
          const awayName = match?.teams?.away?.name || 'Fora';
          const elapsed = match?.fixture?.status?.elapsed || 0;
          const homeGoals = match?.goals?.home ?? 0;
          const awayGoals = match?.goals?.away ?? 0;
          const stats = statsMap[id];
          const homeCorners = stats?.home?.corners || 0;
          const awayCorners = stats?.away?.corners || 0;
          const rawHomeDA = stats?.home?.dangerousAttacks || 0;
          const rawAwayDA = stats?.away?.dangerousAttacks || 0;
          const homeDA = rawHomeDA > 0 ? rawHomeDA : Math.round(((stats?.home?.totalShots || 0) * 1.5) + ((homeCorners || 0) * 2));
          const awayDA = rawAwayDA > 0 ? rawAwayDA : Math.round(((stats?.away?.totalShots || 0) * 1.5) + ((awayCorners || 0) * 2));

          let cornerTimeline: ReturnType<typeof projectCornersByPeriod> = [];
          try { cornerTimeline = projectCornersByPeriod(homeCorners, awayCorners, elapsed); } catch (e) { /* safe */ }

          const isFav = favorites.includes(id);
          const alertLevel = getScannerAlertLevel(analysis, stats?.home, stats?.away);

          // Determine dominant team for alert
          const dominant = homeDA >= awayDA ? 'home' : 'away';
          const dominantName = dominant === 'home' ? homeName : awayName;
          const dominantDA = dominant === 'home' ? homeDA : awayDA;
          const opponentDA = dominant === 'home' ? awayDA : homeDA;
          const totalDA = homeDA + awayDA;
          const diffPct = totalDA > 0 ? Math.round((dominantDA / totalDA) * 100) : 50;

          const rankBorderColor = rankIndex === 0 ? 'border-orange-500/60' : rankIndex <= 2 ? 'border-cyan-500/40' : 'border-[#30363D]';
          const rankBg = rankIndex === 0 ? 'bg-orange-500/5' : '';

          return (
            <div key={id} className={`${rankBg} border rounded-2xl overflow-hidden shadow-lg shadow-black/20 ${isFav ? 'border-yellow-500/50' : rankBorderColor}`}>

              {/* ═══ RANKING BADGE + ALERT ═══ */}
              <div className={`flex items-center justify-between px-4 py-2 border-b ${
                alertLevel === 'maximo' ? 'bg-red-500/15 border-red-500/30' : 'bg-[#0D1117] border-[#30363D]'
              }`}>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-black ${rankIndex === 0 ? 'text-orange-400' : 'text-gray-400'}`}>
                    #{rankIndex + 1}
                  </span>
                  <span className="text-[10px] text-gray-500 font-bold uppercase">Score: {scannerScore.toFixed(0)}</span>
                </div>
                <div className="flex items-center gap-2">
                  {alertLevel === 'maximo' && (
                    <span className="text-[10px] font-black text-red-400 uppercase tracking-wider animate-pulse flex items-center gap-1">
                      <Crosshair className="w-3 h-3" /> ALERTA MÁXIMO
                    </span>
                  )}
                  {alertLevel === 'observar' && (
                    <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1">
                      <Eye className="w-3 h-3" /> OBSERVAR
                    </span>
                  )}
                </div>
              </div>

              {/* Smart Filter Banner */}
              {smartFilter && (
                <div className="bg-orange-500/15 border-b border-orange-500/30 px-4 py-2 flex items-center gap-2">
                  <Flame className="w-4 h-4 text-orange-400" />
                  <span className="text-[10px] font-bold text-orange-300">{smartFilter.reason}</span>
                </div>
              )}

              {/* League & Status */}
              <div className="bg-[#0D1117] px-4 py-3 flex items-center justify-between border-b border-[#30363D]">
                <span className="text-xs text-gray-400 font-medium">{match?.league?.name || match?.league || ''}</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleFavorite(id)}
                    className="p-1 rounded-md hover:bg-white/5 transition-colors"
                    title={isFav ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
                  >
                    <Star className={`w-4 h-4 ${isFav ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600'}`} />
                  </button>
                  <span className="bg-red-500/20 text-red-400 text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider animate-pulse">
                    🔴 {elapsed}'
                  </span>
                </div>
              </div>

              {/* Score */}
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-4 bg-[#0D1117]">
                <div className="text-right">
                  <p className="font-bold text-base leading-tight text-white">{homeName}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">{pressure.homeSignal}</p>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-black tabular-nums text-white">{homeGoals} - {awayGoals}</p>
                </div>
                <div className="text-left">
                  <p className="font-bold text-base leading-tight text-white">{awayName}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">{pressure.awaySignal}</p>
                </div>
              </div>

              {/* ═══ ALERTA MÁXIMO CARD ═══ */}
              {alertLevel === 'maximo' && (
                <div className="mx-4 mb-2 mt-2 rounded-xl bg-red-500/15 border border-red-500/40 overflow-hidden">
                  <div className="bg-red-500/20 px-4 py-2 flex items-center gap-2 animate-pulse">
                    <Crosshair className="w-4 h-4 text-red-400" />
                    <span className="text-xs font-black text-red-300 uppercase tracking-wider">
                      🚨 GOL MUITO PROVÁVEL — {dominantName}
                    </span>
                  </div>
                  <div className="px-4 py-3 space-y-1.5">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-gray-400">IA</span>
                      <span className="text-orange-300 font-bold">Olho que Tudo Vê</span>
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span className="text-gray-400">Time Dominante</span>
                      <span className="text-red-300 font-bold">{dominantName} ({dominant === 'home' ? 'CASA' : 'FORA'})</span>
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span className="text-gray-400">Pressão</span>
                      <span className="text-red-300 font-bold">ALTA — {dominantDA} at. perigosos ({diffPct}%)</span>
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span className="text-gray-400">Confiança</span>
                      <span className="text-red-300 font-bold">{Math.max(imminentHome.score, imminentAway.score)}%</span>
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span className="text-gray-400">Recomendação</span>
                      <span className="text-emerald-400 font-bold">
                        {(homeGoals + awayGoals) === 0 ? 'OVER 0.5 Gols' : `Próximo Gol: ${dominantName}`}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Pressure extreme alert (non-imminent) */}
              {alertLevel !== 'maximo' && (pressure.homePI >= 70 || pressure.awayPI >= 70) && (
                <div className="mx-4 mb-2 mt-2 py-2 px-3 rounded-lg bg-orange-500/15 border border-orange-500/30 flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-orange-400" />
                  <span className="text-xs font-bold text-orange-300">
                    🔥 PRESSÃO EXTREMA — {pressure.homePI >= 70 ? `${homeName} (PI ${pressure.homePI.toFixed(1)})` : `${awayName} (PI ${pressure.awayPI.toFixed(1)})`}
                  </span>
                </div>
              )}

              {/* ═══ LIVE PERFORMANCE & PI ═══ */}
              <div className="px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Live Performance & PI</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-[#0D1117] border border-[#30363D] rounded-lg py-2">
                    <p className="text-[9px] text-gray-500 font-bold uppercase">AP5 (5min)</p>
                    <div className="flex justify-center gap-2 mt-1">
                      <span className={`text-sm font-black tabular-nums ${apWindows.ap5Home >= 60 ? 'text-emerald-400' : 'text-gray-300'}`}>{apWindows.ap5Home.toFixed(0)}</span>
                      <span className="text-[10px] text-[#30363D]">vs</span>
                      <span className={`text-sm font-black tabular-nums ${apWindows.ap5Away >= 60 ? 'text-red-400' : 'text-gray-300'}`}>{apWindows.ap5Away.toFixed(0)}</span>
                    </div>
                  </div>
                  <div className="bg-[#0D1117] border border-[#30363D] rounded-lg py-2">
                    <p className="text-[9px] text-gray-500 font-bold uppercase">AP10 (10min)</p>
                    <div className="flex justify-center gap-2 mt-1">
                      <span className={`text-sm font-black tabular-nums ${apWindows.ap10Home >= 60 ? 'text-emerald-400' : 'text-gray-300'}`}>{apWindows.ap10Home.toFixed(0)}</span>
                      <span className="text-[10px] text-[#30363D]">vs</span>
                      <span className={`text-sm font-black tabular-nums ${apWindows.ap10Away >= 60 ? 'text-red-400' : 'text-gray-300'}`}>{apWindows.ap10Away.toFixed(0)}</span>
                    </div>
                  </div>
                  <div className="bg-[#0D1117] border border-[#30363D] rounded-lg py-2">
                    <p className="text-[9px] text-gray-500 font-bold uppercase">Periculosidade</p>
                    <div className="flex justify-center gap-2 mt-1">
                      <span className={`text-sm font-black tabular-nums ${periculosity.home >= 70 ? 'text-red-400' : periculosity.home >= 50 ? 'text-orange-400' : 'text-gray-300'}`}>{periculosity.home.toFixed(0)}</span>
                      <span className="text-[10px] text-[#30363D]">vs</span>
                      <span className={`text-sm font-black tabular-nums ${periculosity.away >= 70 ? 'text-red-400' : periculosity.away >= 50 ? 'text-orange-400' : 'text-gray-300'}`}>{periculosity.away.toFixed(0)}</span>
                    </div>
                  </div>
                </div>
                <div className="flex justify-between mt-1 px-1">
                  <span className="text-[8px] text-gray-500">{periculosity.homeLabel}</span>
                  <span className="text-[8px] text-gray-500">{periculosity.awayLabel}</span>
                </div>
              </div>

              {/* ═══ IMMINENT GOAL METERS ═══ */}
              <div className="px-4 pb-3 grid grid-cols-2 gap-2">
                <div className="bg-[#0D1117] border border-[#30363D] rounded-lg p-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[9px] text-gray-500 font-bold uppercase">Gol Iminente</span>
                    <span className={`text-xs font-black tabular-nums ${imminentHome.score >= 70 ? 'text-red-400' : 'text-gray-400'}`}>
                      {imminentHome.score}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-[#30363D]/50 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${
                        imminentHome.score >= 70 ? 'bg-red-500 animate-pulse' : imminentHome.score >= 50 ? 'bg-red-500/60' : 'bg-[#30363D]'
                      }`}
                      style={{ width: `${imminentHome.score}%` }}
                    />
                  </div>
                  <p className="text-[8px] text-gray-600 mt-1 truncate">{imminentHome.reason}</p>
                </div>
                <div className="bg-[#0D1117] border border-[#30363D] rounded-lg p-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[9px] text-gray-500 font-bold uppercase">Gol Iminente</span>
                    <span className={`text-xs font-black tabular-nums ${imminentAway.score >= 70 ? 'text-red-400' : 'text-gray-400'}`}>
                      {imminentAway.score}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-[#30363D]/50 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${
                        imminentAway.score >= 70 ? 'bg-blue-500 animate-pulse' : imminentAway.score >= 50 ? 'bg-blue-500/60' : 'bg-[#30363D]'
                      }`}
                      style={{ width: `${imminentAway.score}%` }}
                    />
                  </div>
                  <p className="text-[8px] text-gray-600 mt-1 truncate">{imminentAway.reason}</p>
                </div>
              </div>

              {/* ═══ PRESSURE BARS ═══ */}
              <div className="px-4 pb-3 space-y-2">
                <div>
                  <div className="flex justify-between text-[10px] mb-1">
                    <span className="text-emerald-400 font-bold">PI Casa: {pressure.homePI.toFixed(1)} ({normalizePressure(pressure.homePI).toFixed(0)}/100)</span>
                    <span className="text-gray-500 font-medium">{pressure.homePressureShare}% da pressão</span>
                  </div>
                  <div className="h-2 bg-[#30363D]/50 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full transition-all duration-500"
                      style={{ width: `${normalizePressure(pressure.homePI)}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-[10px] mb-1">
                    <span className="text-red-400 font-bold">PI Fora: {pressure.awayPI.toFixed(1)} ({normalizePressure(pressure.awayPI).toFixed(0)}/100)</span>
                    <span className="text-gray-500 font-medium">{pressure.awayPressureShare}% da pressão</span>
                  </div>
                  <div className="h-2 bg-[#30363D]/50 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-red-600 to-red-400 rounded-full transition-all duration-500"
                      style={{ width: `${normalizePressure(pressure.awayPI)}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Dominance */}
              <div className="px-4 pb-3">
                <div className={`text-center py-2 rounded-lg text-xs font-bold border ${
                  pressure.dominance === 'home'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : pressure.dominance === 'away'
                    ? 'bg-red-500/10 text-red-400 border-red-500/20'
                    : 'bg-[#0D1117] text-gray-400 border-[#30363D]'
                }`}>
                  {pressure.dominance === 'home' && `🟢 ${homeName} DOMINANDO`}
                  {pressure.dominance === 'away' && `🔴 ${awayName} DOMINANDO`}
                  {pressure.dominance === 'balanced' && '⚖️ JOGO EQUILIBRADO'}
                </div>
              </div>

              {/* ═══ MOMENTUM CHART ═══ */}
              <div className="px-4 pb-4">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Momentum de Pressão (PI Diff)</span>
                </div>
                <MomentumChart
                  history={history.length >= 1 ? (history.length === 1 ? [...history, { ...history[0], minute: history[0].minute + 1 }] : history) : [{ minute: elapsed, homePI: pressure.homePI, awayPI: pressure.awayPI }]}
                  homeName={homeName}
                  awayName={awayName}
                  currentMinute={elapsed}
                />
              </div>

              {/* ═══ ODDS DEVIATION ═══ */}
              <div className="px-4 pb-3">
                <div className="flex items-center gap-2 mb-2">
                  <BarChart3 className="w-3.5 h-3.5 text-purple-400" />
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Odds Poisson Live</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-[#0D1117] border border-[#30363D] rounded-lg py-2">
                    <p className="text-[9px] text-gray-500">{homeName}</p>
                    <p className="text-sm font-black text-emerald-400 tabular-nums">{oddsDeviation.homeWinPoisson}%</p>
                    <p className="text-[9px] text-gray-600 tabular-nums">@{oddsDeviation.homeImpliedOdd}</p>
                  </div>
                  <div className="bg-[#0D1117] border border-[#30363D] rounded-lg py-2">
                    <p className="text-[9px] text-gray-500">Empate</p>
                    <p className="text-sm font-black text-gray-300 tabular-nums">{oddsDeviation.drawPoisson}%</p>
                    <p className="text-[9px] text-gray-600 tabular-nums">@{oddsDeviation.drawImpliedOdd}</p>
                  </div>
                  <div className="bg-[#0D1117] border border-[#30363D] rounded-lg py-2">
                    <p className="text-[9px] text-gray-500">{awayName}</p>
                    <p className="text-sm font-black text-red-400 tabular-nums">{oddsDeviation.awayWinPoisson}%</p>
                    <p className="text-[9px] text-gray-600 tabular-nums">@{oddsDeviation.awayImpliedOdd}</p>
                  </div>
                </div>
              </div>

              {/* ═══ OVER GOALS ═══ */}
              <div className="px-4 pb-3">
                <div className="flex items-center gap-2 mb-2">
                  <Target className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Probabilidade Over Gols (Poisson)</span>
                </div>
                <OverGoalsPanel
                  homeStats={stats?.home || null}
                  awayStats={stats?.away || null}
                  homeGoals={homeGoals}
                  awayGoals={awayGoals}
                  minute={elapsed}
                />
              </div>

              {/* ═══ ESTRATÉGIA LIVE ═══ */}
              {strategies.length > 0 && (
                <div className="px-4 pb-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Target className="w-3.5 h-3.5 text-orange-500" />
                    <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Estratégia Live</span>
                  </div>
                  <div className="space-y-2">
                    {strategies.map((s, i) => {
                      const style = signalStyles[s.signal] || signalStyles.wait;
                      return (
                        <div key={i} className={`${style.bg} border ${style.border} rounded-lg p-3`}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-bold">{style.icon} {s.market}</span>
                            {s.confidence > 0 && (
                              <span className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded bg-[#0D1117] border border-[#30363D]">
                                {s.confidence}%
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-gray-400 leading-relaxed">{s.reason}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ═══ HT/FT ═══ */}
              {htft.length > 0 && (
                <div className="px-4 pb-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Crosshair className="w-3.5 h-3.5 text-cyan-400" />
                    <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Estratégia HT/FT</span>
                  </div>
                  <div className="space-y-2">
                    {htft.map((pred, i) => {
                      const style = signalStyles[pred.signal] || signalStyles.wait;
                      return (
                        <div key={i} className={`${style.bg} border ${style.border} rounded-lg p-3`}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-bold">{style.icon} HT/FT: {pred.label}</span>
                            <span className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded bg-[#0D1117] border border-[#30363D]">
                              {pred.probability}%
                            </span>
                          </div>
                          <p className="text-[10px] text-gray-400 leading-relaxed">{pred.reason}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ═══ CORNER TIMELINE ═══ */}
              {(homeCorners > 0 || awayCorners > 0) && cornerTimeline.length > 0 && (
                <div className="px-4 pb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <BarChart3 className="w-3.5 h-3.5 text-green-400" />
                    <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Escanteios por Período</span>
                  </div>
                  <CornerTimeline data={cornerTimeline} currentMinute={elapsed} />
                </div>
              )}

              {/* ═══ LIVE STATS GRID ═══ */}
              <div className="px-4 pb-4">
                <div className="flex items-center gap-2 mb-2">
                  <ShieldCheck className="w-3.5 h-3.5 text-green-500" />
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Stats em Tempo Real</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-center text-[10px]">
                  <div className="bg-[#0D1117] border border-[#30363D] rounded-lg py-2.5">
                    <p className="text-gray-500 mb-0.5">Posse de Bola</p>
                    <p className="font-bold text-sm tabular-nums text-white">{stats?.home?.possession || 0}% - {stats?.away?.possession || 0}%</p>
                  </div>
                  <div className="bg-[#0D1117] border border-[#30363D] rounded-lg py-2.5">
                    <p className="text-gray-500 mb-0.5">Chutes no Gol</p>
                    <p className="font-bold text-sm tabular-nums text-white">{stats?.home?.shotsOnGoal || 0} - {stats?.away?.shotsOnGoal || 0}</p>
                  </div>
                  <div className="bg-[#0D1117] border border-[#30363D] rounded-lg py-2.5">
                    <p className="text-gray-500 mb-0.5">Finalizações</p>
                    <p className="font-bold text-sm tabular-nums text-white">{stats?.home?.totalShots || 0} - {stats?.away?.totalShots || 0}</p>
                  </div>
                  <div className="bg-[#0D1117] border border-[#30363D] rounded-lg py-2.5">
                    <p className="text-gray-500 mb-0.5">At. Perigosos</p>
                    <p className="font-bold text-sm tabular-nums text-white">{homeDA} - {awayDA}</p>
                  </div>
                  <div className="bg-[#0D1117] border border-[#30363D] rounded-lg py-2.5">
                    <p className="text-gray-500 mb-0.5">Escanteios</p>
                    <p className="font-bold text-sm tabular-nums text-white">{homeCorners} - {awayCorners}</p>
                  </div>
                  <div className="bg-[#0D1117] border border-[#30363D] rounded-lg py-2.5">
                    <p className="text-gray-500 mb-0.5">Ritmo Gols/90'</p>
                    <p className="font-bold text-sm tabular-nums text-white">
                      {elapsed > 0 ? ((homeGoals + awayGoals) / elapsed * 90).toFixed(1) : '0.0'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="px-4 pb-3 border-t border-[#30363D] pt-2">
                <p className="text-[8px] text-[#484F58] text-center uppercase tracking-widest font-mono">
                  Scanner Pro · Olho que Tudo Vê · Ranking #{rankIndex + 1} · Score {scannerScore.toFixed(0)}
                </p>
              </div>
            </div>
          );
        })}
      </main>
    </div>
  );
};

export default Live;
