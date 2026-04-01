import { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { Loader2, RefreshCw, ArrowLeft, Zap, TrendingUp, AlertTriangle, Volume2, VolumeX, Target, ShieldCheck, Flame, BarChart3, Crosshair } from 'lucide-react';
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

interface MatchAnalysis {
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

function safeAnalyze(match: any, statsMap: Record<string, any>): MatchAnalysis {
  const id = match?.fixture?.id || match?.id;
  const stats = statsMap[id];
  const minute = match?.fixture?.status?.elapsed || 1;
  const homeGoals = match?.goals?.home ?? 0;
  const awayGoals = match?.goals?.away ?? 0;
  const homeName = match?.teams?.home?.name || 'Casa';
  const awayName = match?.teams?.away?.name || 'Fora';
  const homeStats = stats?.home || null;
  const awayStats = stats?.away || null;

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

  return { pressure, history, strategies, apWindows, periculosity, imminentHome, imminentAway, oddsDeviation, smartFilter, htft };
}

const Live = () => {
  const [smartFilterOnly, setSmartFilterOnly] = useState(false);
  const [fullStatsOnly, setFullStatsOnly] = useState(false);

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
  });

  const DEFAULT_TEAM_STATS = { shotsOnGoal: 0, possession: 50, corners: 0, dangerousAttacks: 0, totalShots: 0 };

  const statsMap = useMemo(() => {
    const result: Record<string, any> = {};
    for (const match of matches as any[]) {
      const id = match?.fixture?.id || match?.id;
      if (!id) continue;
      const s = match?.stats;
      result[id] = {
        home: s?.home || { ...DEFAULT_TEAM_STATS },
        away: s?.away || { ...DEFAULT_TEAM_STATS },
      };
    }
    return result;
  }, [matches]);

  const analysisMap = useMemo(() => {
    const map: Record<string, MatchAnalysis> = {};
    for (const match of matches as any[]) {
      const id = match?.fixture?.id || match?.id;
      if (!id) continue;
      map[id] = safeAnalyze(match, statsMap);
    }
    return map;
  }, [matches, statsMap]);

  // Sound alert
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

  const smartFilterCount = useMemo(() =>
    Object.values(analysisMap).filter(a => a.smartFilter).length,
  [analysisMap]);

  const hasFullStats = useCallback((match: any) => {
    const id = match?.fixture?.id || match?.id;
    const s = statsMap[id];
    if (!s) return false;
    const h = s.home;
    const a = s.away;
    return (
      (h?.shotsOnGoal > 0 || a?.shotsOnGoal > 0) ||
      (h?.dangerousAttacks > 0 || a?.dangerousAttacks > 0) ||
      (h?.totalShots > 0 || a?.totalShots > 0) ||
      (h?.corners > 0 || a?.corners > 0) ||
      (h?.possession !== 50 || a?.possession !== 50)
    );
  }, [statsMap]);

  const fullStatsCount = useMemo(() =>
    (matches as any[]).filter(hasFullStats).length,
  [matches, hasFullStats]);

  const displayMatches = useMemo(() => {
    let all = matches as any[];
    if (fullStatsOnly) {
      all = all.filter(hasFullStats);
    }
    if (smartFilterOnly) {
      all = all.filter((match: any) => {
        const id = match?.fixture?.id || match?.id;
        return analysisMap[id]?.smartFilter;
      });
    }
    return all;
  }, [matches, smartFilterOnly, fullStatsOnly, analysisMap, hasFullStats]);

  return (
    <div className="min-h-screen bg-[#0D1117] text-[#e6edf3]">
      {/* ═══ HEADER ═══ */}
      <header className="border-b border-[#30363D] bg-[#161B22]/95 backdrop-blur-md sticky top-0 z-50">
        <div className="container max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="p-2 hover:bg-white/5 rounded-full transition-colors"><ArrowLeft className="w-5 h-5" /></Link>
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-orange-500" />
              <div>
                <h1 className="font-bold text-lg tracking-tight text-white">ELITE LIVE METRICS</h1>
                <p className="text-[8px] text-orange-500/70 font-bold uppercase tracking-widest">LIVE TRADER PRO · V2</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`p-2 rounded-lg transition-colors border ${soundEnabled ? 'bg-orange-500/20 text-orange-400 border-orange-500/30' : 'bg-[#161B22] text-gray-500 border-[#30363D]'}`}
            >
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>
            <button
              onClick={() => refetch()}
              className="flex items-center gap-2 text-xs bg-[#161B22] border border-[#30363D] px-3 py-2 rounded-lg hover:bg-[#1c2333] transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin text-orange-500' : 'text-gray-400'}`} />
            </button>
          </div>
        </div>
      </header>

      <div className="container max-w-3xl mx-auto px-4 pt-3 flex flex-wrap gap-2">
        <button
          onClick={() => setFullStatsOnly(!fullStatsOnly)}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all border ${
            fullStatsOnly
              ? 'bg-cyan-500 text-white border-cyan-600'
              : 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
          }`}
        >
          <BarChart3 className="w-3.5 h-3.5" />
          📊 Dados Completos ({fullStatsCount}/{(matches as any[]).length})
        </button>

        {smartFilterCount > 0 && (
          <button
            onClick={() => setSmartFilterOnly(!smartFilterOnly)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all border ${
              smartFilterOnly
                ? 'bg-orange-500 text-white border-orange-600'
                : 'bg-orange-500/10 text-orange-400 border-orange-500/30'
            }`}
          >
            <Flame className="w-3.5 h-3.5" />
            🔥 Favoritos Perdendo ({smartFilterCount})
          </button>
        )}
      </div>

      <main className="container max-w-3xl mx-auto px-4 py-4 space-y-5">
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
            <p className="text-sm text-gray-400">Carregando jogos ao vivo...</p>
          </div>
        )}

        {!isLoading && matches.length === 0 && (
          <div className="text-center py-20">
            <AlertTriangle className="w-10 h-10 text-yellow-500 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">Nenhum jogo ao vivo no momento.</p>
            <p className="text-gray-500 text-xs mt-1">Os jogos aparecerão automaticamente quando começarem.</p>
          </div>
        )}

        {displayMatches.map((match: any) => {
          const id = match?.fixture?.id || match?.id;
          const analysis = analysisMap[id];
          if (!analysis) return null;

          const { pressure, history, strategies, apWindows, periculosity, imminentHome, imminentAway, oddsDeviation, smartFilter, htft } = analysis;
          const homeName = match?.teams?.home?.name || 'Casa';
          const awayName = match?.teams?.away?.name || 'Fora';
          const elapsed = match?.fixture?.status?.elapsed || 0;
          const homeGoals = match?.goals?.home ?? 0;
          const awayGoals = match?.goals?.away ?? 0;
          const stats = statsMap[id];
          const homeCorners = stats?.home?.corners || 0;
          const awayCorners = stats?.away?.corners || 0;

          let cornerTimeline: ReturnType<typeof projectCornersByPeriod> = [];
          try { cornerTimeline = projectCornersByPeriod(homeCorners, awayCorners, elapsed); } catch (e) { /* safe */ }

          return (
            <div key={id} className="bg-[#161B22] border border-[#30363D] rounded-2xl overflow-hidden shadow-lg shadow-black/20">
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
                <span className="bg-red-500/20 text-red-400 text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider animate-pulse">
                  🔴 {elapsed}'
                </span>
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

              {/* ═══ ALERTS ═══ */}
              {(imminentHome.isTriggered || imminentAway.isTriggered) && (
                <div className="mx-4 mb-2 mt-2 py-2 px-3 rounded-lg bg-red-500/20 border border-red-500/40 flex items-center gap-2 animate-pulse">
                  <Crosshair className="w-4 h-4 text-red-400" />
                  <span className="text-xs font-bold text-red-300">
                    ⚠️ GOL IMINENTE — {imminentHome.isTriggered ? `${homeName} (${imminentHome.score}%)` : ''}{imminentHome.isTriggered && imminentAway.isTriggered ? ' | ' : ''}{imminentAway.isTriggered ? `${awayName} (${imminentAway.score}%)` : ''}
                  </span>
                </div>
              )}

              {(pressure.homePI >= 70 || pressure.awayPI >= 70) && !(imminentHome.isTriggered || imminentAway.isTriggered) && (
                <div className="mx-4 mb-2 mt-2 py-2 px-3 rounded-lg bg-orange-500/15 border border-orange-500/30 flex items-center gap-2 animate-pulse">
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

              {/* ═══ MOMENTUM CHART (PI DIFF) ═══ */}
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

              {/* ═══ ODDS DEVIATION (Poisson Live) ═══ */}
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

              {/* ═══ OVER GOALS HT / FT (Poisson) ═══ */}
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

              {/* ═══ ESTRATÉGIA DE TRADE LIVE ═══ */}
              {strategies.length > 0 && (
                <div className="px-4 pb-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Target className="w-3.5 h-3.5 text-orange-500" />
                    <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                      Estratégia Live
                    </span>
                  </div>
                  <div className="space-y-2">
                    {strategies.map((s, i) => {
                      const style = signalStyles[s.signal] || signalStyles.wait;
                      return (
                        <div key={i} className={`${style.bg} border ${style.border} rounded-lg p-3`}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-bold">
                              {style.icon} {s.market}
                            </span>
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

              {/* ═══ HT/FT STRATEGY ═══ */}
              {htft.length > 0 && (
                <div className="px-4 pb-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Crosshair className="w-3.5 h-3.5 text-cyan-400" />
                    <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                      Estratégia HT/FT
                    </span>
                  </div>
                  <div className="space-y-2">
                    {htft.map((pred, i) => {
                      const style = signalStyles[pred.signal] || signalStyles.wait;
                      return (
                        <div key={i} className={`${style.bg} border ${style.border} rounded-lg p-3`}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-bold">
                              {style.icon} HT/FT: {pred.label}
                            </span>
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
                    <p className="font-bold text-sm tabular-nums text-white">{stats?.home?.dangerousAttacks || 0} - {stats?.away?.dangerousAttacks || 0}</p>
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
                  Elite Metrics v2 · Poisson Live · PI Diff · Polling 60s
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
