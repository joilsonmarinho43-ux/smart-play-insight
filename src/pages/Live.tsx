import { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { Loader2, RefreshCw, ArrowLeft, Zap, TrendingUp, AlertTriangle, Volume2, VolumeX, Target, ShieldCheck } from 'lucide-react';
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
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';

const Live = () => {
  const {
    data: matches = [],
    isLoading,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['live-matches'],
    queryFn: () => fetchLiveMatches(),
    refetchInterval: 25000,
    staleTime: 20000,
  });

  const statsMap = useMemo(() => {
    const result: Record<string, any> = {};
    for (const match of matches as any[]) {
      const id = match?.fixture?.id || match?.id;
      if (!id) continue;
      if (match?.stats?.home || match?.stats?.away) {
        result[id] = match.stats;
      }
    }
    return result;
  }, [matches]);

  const analysisMap = useMemo(() => {
    const map: Record<string, { pressure: PressureData; history: PISnapshot[]; strategies: LiveStrategy[] }> = {};

    for (const match of matches as any[]) {
      const id = match?.fixture?.id || match?.id;
      if (!id) continue;
      const stats = statsMap[id];
      const minute = match?.fixture?.status?.elapsed || 1;
      const homeGoals = match?.goals?.home ?? 0;
      const awayGoals = match?.goals?.away ?? 0;
      const homeName = match?.teams?.home?.name || 'Casa';
      const awayName = match?.teams?.away?.name || 'Fora';

      const pressure = analyzeLivePressure(stats?.home || null, stats?.away || null, minute);
      const history = recordPISnapshot(id, pressure.homePI, pressure.awayPI, minute);
      const strategies = generateLiveStrategy(
        stats?.home || null, stats?.away || null,
        minute, homeGoals, awayGoals, homeName, awayName
      );
      map[id] = { pressure, history, strategies };
    }
    return map;
  }, [matches, statsMap]);

  // Sound alert for PI > 70
  const [soundEnabled, setSoundEnabled] = useState(true);
  const alertedRef = useRef<Set<string>>(new Set());

  const playAlertSound = useCallback(() => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.5);
    } catch (e) {
      console.warn('Audio not available');
    }
  }, []);

  useEffect(() => {
    if (!soundEnabled) return;
    for (const [id, { pressure }] of Object.entries(analysisMap)) {
      const homeKey = `${id}_home`;
      const awayKey = `${id}_away`;
      if (pressure.homePI >= 70 && !alertedRef.current.has(homeKey)) {
        alertedRef.current.add(homeKey);
        playAlertSound();
      }
      if (pressure.awayPI >= 70 && !alertedRef.current.has(awayKey)) {
        alertedRef.current.add(awayKey);
        playAlertSound();
      }
      if (pressure.homePI < 60) alertedRef.current.delete(homeKey);
      if (pressure.awayPI < 60) alertedRef.current.delete(awayKey);
    }
  }, [analysisMap, soundEnabled, playAlertSound]);

  const signalStyles: Record<string, { bg: string; border: string; icon: string }> = {
    entry: { bg: 'bg-green-500/10', border: 'border-green-500/30', icon: '🟢' },
    wait: { bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', icon: '🟡' },
    caution: { bg: 'bg-red-500/10', border: 'border-red-500/30', icon: '🔴' },
  };

  return (
    <div className="min-h-screen bg-[#0a0f1c] text-white">
      <header className="border-b border-white/10 bg-[#111827]/90 backdrop-blur-md sticky top-0 z-50">
        <div className="container max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="p-2 hover:bg-white/5 rounded-full"><ArrowLeft className="w-5 h-5" /></Link>
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-orange-500" />
              <h1 className="font-bold text-lg tracking-tight">LIVE TRADER PRO</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`p-2 rounded-lg transition-colors ${soundEnabled ? 'bg-orange-500/20 text-orange-400' : 'bg-white/5 text-gray-500'}`}
            >
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>
            <button
              onClick={() => refetch()}
              className="flex items-center gap-2 text-xs bg-white/5 px-3 py-2 rounded-lg hover:bg-white/10 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin text-orange-500' : 'text-gray-400'}`} />
              Atualizar
            </button>
          </div>
        </div>
      </header>

      <main className="container max-w-3xl mx-auto px-4 py-6 space-y-5">
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

        {(matches as any[]).map((match: any) => {
          const id = match?.fixture?.id || match?.id;
          const analysis = analysisMap[id];
          if (!analysis) return null;

          const { pressure, history, strategies } = analysis;
          const homeName = match?.teams?.home?.name || 'Casa';
          const awayName = match?.teams?.away?.name || 'Fora';
          const elapsed = match?.fixture?.status?.elapsed || 0;
          const homeGoals = match?.goals?.home ?? 0;
          const awayGoals = match?.goals?.away ?? 0;
          const stats = statsMap[id];

          return (
            <div key={id} className="bg-[#1e293b] border border-white/5 rounded-2xl overflow-hidden">
              {/* Match Header */}
              <div className="bg-[#111827] px-4 py-3 flex items-center justify-between">
                <span className="text-xs text-gray-400 font-medium">{match?.league?.name || match?.league || ''}</span>
                <span className="bg-red-500/20 text-red-400 text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider animate-pulse">
                  🔴 {elapsed}'
                </span>
              </div>

              {/* Score */}
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-4">
                <div className="text-right">
                  <p className="font-bold text-base leading-tight">{homeName}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{pressure.homeSignal}</p>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-black tabular-nums">{homeGoals} - {awayGoals}</p>
                </div>
                <div className="text-left">
                  <p className="font-bold text-base leading-tight">{awayName}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{pressure.awaySignal}</p>
                </div>
              </div>

              {/* PI Alert */}
              {(pressure.homePI >= 70 || pressure.awayPI >= 70) && (
                <div className="mx-4 mb-2 py-2 px-3 rounded-lg bg-orange-500/15 border border-orange-500/30 flex items-center gap-2 animate-pulse">
                  <Volume2 className="w-4 h-4 text-orange-400" />
                  <span className="text-xs font-bold text-orange-300">
                    🔥 PRESSÃO EXTREMA — {pressure.homePI >= 70 ? `${homeName} (PI ${pressure.homePI.toFixed(1)})` : `${awayName} (PI ${pressure.awayPI.toFixed(1)})`}
                  </span>
                </div>
              )}

              {/* Pressure Bars */}
              <div className="px-4 pb-3 space-y-2">
                <div>
                  <div className="flex justify-between text-[10px] mb-1">
                    <span className="text-red-400 font-bold">PI Casa: {pressure.homePI.toFixed(1)}</span>
                    <span className="text-gray-500 font-medium">{pressure.homePressureShare}% da pressão</span>
                  </div>
                  <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-red-600 to-red-400 rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(100, pressure.homePI)}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-[10px] mb-1">
                    <span className="text-blue-400 font-bold">PI Fora: {pressure.awayPI.toFixed(1)}</span>
                    <span className="text-gray-500 font-medium">{pressure.awayPressureShare}% da pressão</span>
                  </div>
                  <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-blue-600 to-blue-400 rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(100, pressure.awayPI)}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Dominance */}
              <div className="px-4 pb-3">
                <div className={`text-center py-2 rounded-lg text-xs font-bold ${
                  pressure.dominance === 'home'
                    ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                    : pressure.dominance === 'away'
                    ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                    : 'bg-gray-500/10 text-gray-400 border border-gray-500/20'
                }`}>
                  {pressure.dominance === 'home' && `🔴 ${homeName} DOMINANDO`}
                  {pressure.dominance === 'away' && `🔵 ${awayName} DOMINANDO`}
                  {pressure.dominance === 'balanced' && '⚖️ JOGO EQUILIBRADO'}
                </div>
              </div>

              {/* ═══ ESTRATÉGIA DE TRADE LIVE ═══ */}
              {strategies.length > 0 && (
                <div className="px-4 pb-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Target className="w-3.5 h-3.5 text-orange-500" />
                    <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                      Estratégia Live (Dados Reais)
                    </span>
                  </div>
                  <div className="space-y-2">
                    {strategies.map((s, i) => {
                      const style = signalStyles[s.signal];
                      return (
                        <div key={i} className={`${style.bg} border ${style.border} rounded-lg p-3`}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-bold">
                              {style.icon} {s.market}
                            </span>
                            {s.confidence > 0 && (
                              <span className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded bg-white/5">
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

              {/* PI Chart */}
              {history.length >= 2 && (
                <div className="px-4 pb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="w-3.5 h-3.5 text-orange-500" />
                    <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Oscilação de Pressão</span>
                  </div>
                  <div className="bg-[#111827] rounded-xl p-3 border border-white/5">
                    <ResponsiveContainer width="100%" height={120}>
                      <LineChart data={history}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="minute" tick={{ fontSize: 10, fill: '#6b7280' }} tickFormatter={(v) => `${v}'`} />
                        <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} width={30} />
                        <Tooltip
                          contentStyle={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '11px' }}
                          labelFormatter={(v) => `Minuto ${v}`}
                        />
                        <Line type="monotone" dataKey="homePI" stroke="#ef4444" strokeWidth={2} dot={false} name="Casa PI" />
                        <Line type="monotone" dataKey="awayPI" stroke="#3b82f6" strokeWidth={2} dot={false} name="Fora PI" />
                      </LineChart>
                    </ResponsiveContainer>
                    <div className="flex justify-center gap-6 mt-2">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                        <span className="text-[10px] text-gray-400">Casa</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                        <span className="text-[10px] text-gray-400">Fora</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Live Stats Grid — TODOS os dados reais */}
              {stats && (
                <div className="px-4 pb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <ShieldCheck className="w-3.5 h-3.5 text-green-500" />
                    <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Stats em Tempo Real (API)</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-center text-[10px]">
                    <div className="bg-white/5 rounded-lg py-2.5">
                      <p className="text-gray-500 mb-0.5">Posse de Bola</p>
                      <p className="font-bold text-sm tabular-nums">{stats?.home?.possession || 0}% - {stats?.away?.possession || 0}%</p>
                    </div>
                    <div className="bg-white/5 rounded-lg py-2.5">
                      <p className="text-gray-500 mb-0.5">Chutes no Gol</p>
                      <p className="font-bold text-sm tabular-nums">{stats?.home?.shotsOnGoal || 0} - {stats?.away?.shotsOnGoal || 0}</p>
                    </div>
                    <div className="bg-white/5 rounded-lg py-2.5">
                      <p className="text-gray-500 mb-0.5">Finalizações</p>
                      <p className="font-bold text-sm tabular-nums">{stats?.home?.totalShots || 0} - {stats?.away?.totalShots || 0}</p>
                    </div>
                    <div className="bg-white/5 rounded-lg py-2.5">
                      <p className="text-gray-500 mb-0.5">At. Perigosos</p>
                      <p className="font-bold text-sm tabular-nums">{stats?.home?.dangerousAttacks || 0} - {stats?.away?.dangerousAttacks || 0}</p>
                    </div>
                    <div className="bg-white/5 rounded-lg py-2.5">
                      <p className="text-gray-500 mb-0.5">Escanteios</p>
                      <p className="font-bold text-sm tabular-nums">{stats?.home?.corners || 0} - {stats?.away?.corners || 0}</p>
                    </div>
                    <div className="bg-white/5 rounded-lg py-2.5">
                      <p className="text-gray-500 mb-0.5">Ritmo Gols/90'</p>
                      <p className="font-bold text-sm tabular-nums">
                        {elapsed > 0 ? ((homeGoals + awayGoals) / elapsed * 90).toFixed(1) : '0.0'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Source */}
              <div className="px-4 pb-3">
                <p className="text-[8px] text-gray-600 text-center uppercase tracking-widest">
                  Dados reais · API-Sports · Atualizado a cada 25s
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
