import { useMemo } from 'react';
import { Loader2, RefreshCw, ArrowLeft, Zap, TrendingUp, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchLiveMatches } from '@/services/footballApi';
import {
  analyzeLivePressure,
  recordPISnapshot,
  getPIHistory,
  type PressureData,
  type PISnapshot,
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

  // Fetch stats for every live match
  // Use stats already embedded in match data from edge function
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

  // Build pressure analysis per match
  const analysisMap = useMemo(() => {
    const map: Record<string, { pressure: PressureData; history: PISnapshot[] }> = {};

    for (const match of matches as any[]) {
      const id = match?.fixture?.id || match?.id;
      if (!id) continue;
      const stats = statsMap[id];
      const minute = match?.fixture?.status?.elapsed || 1;

      const pressure = analyzeLivePressure(stats?.home || null, stats?.away || null, minute);
      const history = recordPISnapshot(id, pressure.homePI, pressure.awayPI, minute);
      map[id] = { pressure, history };
    }
    return map;
  }, [matches, statsMap]);

  return (
    <div className="min-h-screen bg-[#0a0f1c] text-white">
      {/* HEADER */}
      <header className="border-b border-white/10 bg-[#111827]/90 backdrop-blur-md sticky top-0 z-50">
        <div className="container max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="p-2 hover:bg-white/5 rounded-full"><ArrowLeft className="w-5 h-5" /></Link>
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-orange-500" />
              <h1 className="font-bold text-lg tracking-tight">LIVE TRADER PRO</h1>
            </div>
          </div>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 text-xs bg-white/5 px-3 py-2 rounded-lg hover:bg-white/10 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin text-orange-500' : 'text-gray-400'}`} />
            Atualizar
          </button>
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

          const { pressure, history } = analysis;
          const homeName = match?.teams?.home?.name || 'Casa';
          const awayName = match?.teams?.away?.name || 'Fora';
          const elapsed = match?.fixture?.status?.elapsed || 0;
          const homeGoals = match?.goals?.home ?? 0;
          const awayGoals = match?.goals?.away ?? 0;

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

              {/* Pressure Bars */}
              <div className="px-4 pb-3 space-y-2">
                <div>
                  <div className="flex justify-between text-[10px] mb-1">
                    <span className="text-red-400 font-bold">PI Casa: {pressure.homePI.toFixed(1)}</span>
                    <span className="text-green-400 font-bold">{pressure.homeProbGol}% prob. gol</span>
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
                    <span className="text-green-400 font-bold">{pressure.awayProbGol}% prob. gol</span>
                  </div>
                  <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-blue-600 to-blue-400 rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(100, pressure.awayPI)}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Dominance Badge */}
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

              {/* PI Sparkline Chart */}
              {history.length >= 2 && (
                <div className="px-4 pb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="w-3.5 h-3.5 text-orange-500" />
                    <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Oscilação de Pressão (Últimos snapshots)</span>
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

              {/* Live Stats Raw */}
              {statsMap[id] && (
                <div className="px-4 pb-4">
                  <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
                    <div className="bg-white/5 rounded-lg py-2">
                      <p className="text-gray-400">Chutes Gol</p>
                      <p className="font-bold text-sm">{statsMap[id]?.home?.shotsOnGoal || 0} - {statsMap[id]?.away?.shotsOnGoal || 0}</p>
                    </div>
                    <div className="bg-white/5 rounded-lg py-2">
                      <p className="text-gray-400">At. Perigosos</p>
                      <p className="font-bold text-sm">{statsMap[id]?.home?.dangerousAttacks || 0} - {statsMap[id]?.away?.dangerousAttacks || 0}</p>
                    </div>
                    <div className="bg-white/5 rounded-lg py-2">
                      <p className="text-gray-400">Escanteios</p>
                      <p className="font-bold text-sm">{statsMap[id]?.home?.corners || 0} - {statsMap[id]?.away?.corners || 0}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </main>
    </div>
  );
};

export default Live;
