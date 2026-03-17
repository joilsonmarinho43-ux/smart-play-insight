import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchMatches } from '@/services/footballApi';
import MatchCard from '@/components/MatchCard';
import { useAuth } from '@/hooks/useAuth';
import { Brain, BarChart3, Loader2, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';

const Index = () => {
  const { signOut } = useAuth();
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);

  const { data: matches, isFetching, refetch } = useQuery({
    queryKey: ['matches', date],
    queryFn: () => fetchMatches(date),
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="min-h-screen bg-[#0f172a] text-white pb-32">
      
      {/* HEADER */}
      <header className="border-b border-white/10 bg-[#1e293b]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="container max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          
          <div className="flex items-center gap-3">
            <Brain className="w-8 h-8 text-orange-500" />
            <div>
              <h1 className="text-xl font-bold tracking-tighter">ANALISTA JOILSON</h1>
              <p className="text-[10px] text-orange-500 font-bold uppercase">
                MODELO HÍBRIDO PRO
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input 
              type="date" 
              value={date} 
              onChange={(e) => setDate(e.target.value)}
              className="bg-[#334155] text-xs p-2 rounded-lg outline-none border border-white/10"
            />

            <button 
              onClick={() => refetch()} 
              disabled={isFetching}
              className="bg-orange-500 p-2 rounded-lg hover:bg-orange-600 disabled:opacity-50"
            >
              {isFetching 
                ? <Loader2 className="w-5 h-5 animate-spin" /> 
                : <BarChart3 className="w-5 h-5" />
              }
            </button>
          </div>
        </div>
      </header>

      {/* LISTA DE JOGOS */}
      <main className="container max-w-3xl mx-auto px-4 py-6">
        
        {isFetching && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Loader2 className="w-10 h-10 animate-spin text-orange-500" />
            <p className="text-sm text-gray-400">
              Processando dados da conta PRO...
            </p>
          </div>
        )}

        {!isFetching && matches && matches.length > 0 ? (
          <div className="grid gap-4">
            {matches.map((match: any) => (
              <MatchCard key={match.id} match={match} />
            ))}
          </div>
        ) : !isFetching && (
          <div className="text-center py-20 border border-dashed border-white/10 rounded-2xl">
            <p className="text-gray-400">
              Nenhum jogo relevante para as ligas selecionadas em {date}.
            </p>
          </div>
        )}
      </main>

      {/* BOTÃO LIVE (CORRIGIDO) */}
      <div className="fixed bottom-16 left-0 right-0 flex justify-center z-[9999] px-4 pointer-events-none">
        <Link 
          to="/live" 
          className="pointer-events-auto flex items-center gap-3 bg-orange-600 hover:bg-orange-700 text-white px-6 py-4 rounded-full shadow-[0_10px_30px_rgba(234,88,12,0.4)] transition-all active:scale-95 border border-white/20 w-full max-w-xs justify-center"
        >
          <div className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-white"></span>
          </div>

          <span className="font-black tracking-widest text-sm">
            LIVE TRADE
          </span>

          <Zap className="w-5 h-5 fill-current" />
        </Link>
      </div>

    </div>
  );
};

export default Index;
