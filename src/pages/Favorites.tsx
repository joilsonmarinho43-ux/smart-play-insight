import { useMemo, useState, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Star, Trash2, Zap, RefreshCw, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { fetchLiveMatches } from '@/services/footballApi';
import {
  analyzeLivePressure,
  type PressureData,
} from '@/lib/pressureEngine';
import {
  calculatePericulosity,
  type PericulosityData,
} from '@/lib/eliteMetrics';

const DEFAULT_PRESSURE: PressureData = {
  homePI: 0, awayPI: 0, homeSignal: '🟢 Estável', awaySignal: '🟢 Estável',
  homePressureShare: 50, awayPressureShare: 50, dominance: 'balanced',
};
const DEFAULT_PERIC: PericulosityData = { home: 0, away: 0, homeLabel: '🟢 BAIXO', awayLabel: '🟢 BAIXO' };

const Favorites = () => {
  const [favorites, setFavorites] = useState<number[]>(() => {
    try { return JSON.parse(localStorage.getItem('liveMatchFavorites') || '[]'); } catch { return []; }
  });

  useEffect(() => {
    localStorage.setItem('liveMatchFavorites', JSON.stringify(favorites));
  }, [favorites]);

  const removeFavorite = useCallback((id: number) => {
    setFavorites(prev => prev.filter(x => x !== id));
  }, []);

  const clearAll = useCallback(() => setFavorites([]), []);

  const {
    data: allMatches = [],
    isLoading,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['live-matches'],
    queryFn: () => fetchLiveMatches(),
    refetchInterval: 60000,
    staleTime: 55000,
  });

  const favMatches = useMemo(() => {
    return (allMatches as any[]).filter((m: any) => {
      const id = m?.fixture?.id || m?.id;
      return favorites.includes(id);
    });
  }, [allMatches, favorites]);

  return (
    <div className="min-h-screen bg-[#0D1117] text-[#e6edf3]">
      {/* HEADER */}
      <header className="border-b border-[#30363D] bg-[#161B22]/95 backdrop-blur-md sticky top-0 z-50">
        <div className="container max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/live" className="p-2 hover:bg-white/5 rounded-full transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="flex items-center gap-2">
              <Star className="w-5 h-5 text-yellow-400 fill-yellow-400" />
              <div>
                <h1 className="font-bold text-lg tracking-tight text-white">FAVORITOS</h1>
                <p className="text-[8px] text-yellow-500/70 font-bold uppercase tracking-widest">
                  {favorites.length} jogo{favorites.length !== 1 ? 's' : ''} monitorado{favorites.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {favorites.length > 0 && (
              <button
                onClick={clearAll}
                className="flex items-center gap-1 text-xs bg-red-500/10 text-red-400 border border-red-500/30 px-3 py-2 rounded-lg hover:bg-red-500/20 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Limpar
              </button>
            )}
            <button
              onClick={() => refetch()}
              className="flex items-center gap-2 text-xs bg-[#161B22] border border-[#30363D] px-3 py-2 rounded-lg hover:bg-[#1c2333] transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin text-orange-500' : 'text-gray-400'}`} />
            </button>
          </div>
        </div>
      </header>

      <main className="container max-w-3xl mx-auto px-4 py-4 space-y-4">
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-yellow-500" />
            <p className="text-sm text-gray-400">Carregando favoritos...</p>
          </div>
        )}

        {!isLoading && favorites.length === 0 && (
          <div className="text-center py-20">
            <Star className="w-10 h-10 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">Nenhum jogo favoritado.</p>
            <p className="text-gray-500 text-xs mt-1">
              Volte ao <Link to="/live" className="text-yellow-400 underline">Live</Link> e toque na ⭐ para monitorar jogos.
            </p>
          </div>
        )}

        {!isLoading && favorites.length > 0 && favMatches.length === 0 && (
          <div className="text-center py-20">
            <Star className="w-10 h-10 text-yellow-600 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">Seus favoritos não estão ao vivo agora.</p>
            <p className="text-gray-500 text-xs mt-1">Eles aparecerão quando estiverem em andamento.</p>
          </div>
        )}

        {favMatches.map((match: any) => {
          const id = match?.fixture?.id || match?.id;
          const homeName = match?.teams?.home?.name || 'Casa';
          const awayName = match?.teams?.away?.name || 'Fora';
          const elapsed = match?.fixture?.status?.elapsed || 0;
          const homeGoals = match?.goals?.home ?? 0;
          const awayGoals = match?.goals?.away ?? 0;

          const s = match?.stats;
          const homeStats = s?.home || null;
          const awayStats = s?.away || null;

          let pressure = DEFAULT_PRESSURE;
          let periculosity = DEFAULT_PERIC;

          try { pressure = analyzeLivePressure(homeStats, awayStats, elapsed); } catch {}
          try { periculosity = calculatePericulosity(homeStats, awayStats, elapsed); } catch {}

          return (
            <div key={id} className="bg-[#161B22] border border-yellow-500/40 rounded-2xl overflow-hidden shadow-lg shadow-yellow-500/5">
              {/* League & Status */}
              <div className="bg-[#0D1117] px-4 py-3 flex items-center justify-between border-b border-[#30363D]">
                <span className="text-xs text-gray-400 font-medium">{match?.league?.name || match?.league || ''}</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => removeFavorite(id)}
                    className="p-1 rounded-md hover:bg-red-500/10 transition-colors"
                    title="Remover dos favoritos"
                  >
                    <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
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

              {/* Quick Stats */}
              <div className="px-4 py-3">
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="bg-[#0D1117] border border-[#30363D] rounded-lg py-2">
                    <p className="text-[9px] text-gray-500 font-bold uppercase">PI</p>
                    <div className="flex justify-center gap-2 mt-1">
                      <span className={`text-sm font-black tabular-nums ${pressure.homePI >= 70 ? 'text-emerald-400' : 'text-gray-300'}`}>{pressure.homePI.toFixed(0)}</span>
                      <span className="text-[10px] text-[#30363D]">vs</span>
                      <span className={`text-sm font-black tabular-nums ${pressure.awayPI >= 70 ? 'text-red-400' : 'text-gray-300'}`}>{pressure.awayPI.toFixed(0)}</span>
                    </div>
                  </div>
                  <div className="bg-[#0D1117] border border-[#30363D] rounded-lg py-2">
                    <p className="text-[9px] text-gray-500 font-bold uppercase">Periculosidade</p>
                    <div className="flex justify-center gap-2 mt-1">
                      <span className={`text-sm font-black tabular-nums ${periculosity.home >= 70 ? 'text-red-400' : 'text-gray-300'}`}>{periculosity.home.toFixed(0)}</span>
                      <span className="text-[10px] text-[#30363D]">vs</span>
                      <span className={`text-sm font-black tabular-nums ${periculosity.away >= 70 ? 'text-red-400' : 'text-gray-300'}`}>{periculosity.away.toFixed(0)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </main>
    </div>
  );
};

export default Favorites;
