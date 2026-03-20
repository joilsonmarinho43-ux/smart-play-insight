import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchMatches } from '@/services/footballApi';
import MatchCard from '@/components/MatchCard';
import BingoSuggestion from '@/components/BingoSuggestion';
import { useAuth } from '@/hooks/useAuth';
import { Brain, Loader2, Zap, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';

const Index = () => {
  const { signOut } = useAuth();
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [hasFetchedOnce, setHasFetchedOnce] = useState(false);

  const { data: rawMatches, isFetching, refetch } = useQuery({
    queryKey: ['matches', date],
    queryFn: () => fetchMatches(date),
    enabled: false,
  });

  useEffect(() => {
    if (!hasFetchedOnce) {
      refetch();
      setHasFetchedOnce(true);
    }
  }, [refetch, hasFetchedOnce]);

  const safeMatches = useMemo(() =>
    (rawMatches || []).map((m: any) => ({
      ...m,
      homeTeam: m.teams?.home?.name || m.homeTeam || 'Casa',
      awayTeam: m.teams?.away?.name || m.awayTeam || 'Fora',
      league: m.league?.name || m.league || '',
      time: m.fixture?.date ? new Date(m.fixture.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : m.time || '',
      metrics: m.metrics || {
        possession: [0, 0], xG: null, totalShots: [0, 0], shotsOnTarget: [0, 0],
        bigChances: [0, 0], corners: [0, 0], offsides: [0, 0], fouls: [0, 0], yellowCards: [0, 0]
      },
      modelData: m.modelData || {
        homeGoalsAvg: 1.2, awayGoalsAvg: 1.0, homeCornersAvg: 4, awayCornersAvg: 4,
        homeCardsAvg: 2, awayCardsAvg: 2
      },
      predictions: m.predictions || { homeWin: '0', draw: '0', awayWin: '0' },
    })),
  [rawMatches]);

  return (
    <div className="min-h-screen bg-[#0f172a] text-white pb-32 font-sans">
      <header className="border-b border-white/10 bg-[#1e293b]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="container max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Brain className="w-8 h-8 text-orange-500" />
            <div>
              <h1 className="text-xl font-bold">ANALISTA JOILSON</h1>
              <p className="text-[10px] text-orange-500 font-bold uppercase">MODELO REAL PRO</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => refetch()} className="p-2 bg-white/5 rounded-lg hover:bg-white/10 transition-colors">
              <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin text-orange-500' : 'text-gray-400'}`} />
            </button>
            <input
              type="date"
              value={date}
              onChange={e => { setDate(e.target.value); setHasFetchedOnce(false); }}
              className="bg-[#334155] text-xs p-2 rounded-lg border border-white/10"
            />
            <button onClick={signOut} className="bg-red-500/10 text-red-500 px-3 py-2 rounded-lg text-xs font-bold hover:bg-red-500/20 transition-colors">
              SAIR
            </button>
          </div>
        </div>
      </header>

      <main className="container max-w-3xl mx-auto px-4">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 mt-6">
          <div className="bg-[#1e293b] rounded-xl p-4 text-center border border-white/5">
            <p className="text-xs text-gray-400">Jogos Carregados</p>
            <p className="text-3xl font-black text-orange-500 tabular-nums">{safeMatches.length}</p>
          </div>
          <Link to="/live" className="bg-gradient-to-br from-orange-600 to-red-600 rounded-xl flex flex-col items-center justify-center hover:from-orange-500 hover:to-red-500 transition-all active:scale-[0.97]">
            <Zap className="w-6 h-6 mb-1" />
            <span className="font-black text-sm">LIVE TRADER</span>
            <span className="text-[10px] opacity-80">Pressão em tempo real</span>
          </Link>
        </div>

        {/* Loading */}
        {isFetching && safeMatches.length === 0 && (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
          </div>
        )}

        {/* Bingo Section */}
        {safeMatches.length > 0 && (
          <div className="mt-6">
            <BingoSuggestion matches={safeMatches} />
          </div>
        )}

        {/* Match Cards */}
        <div className="mt-6 space-y-4">
          {safeMatches.map((match: any) => (
            <MatchCard key={match.id} match={match} />
          ))}
        </div>
      </main>
    </div>
  );
};

export default Index;
