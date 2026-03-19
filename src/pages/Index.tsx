import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchMatches } from '@/services/footballApi';
import MatchCard from '@/components/MatchCard';
import { useAuth } from '@/hooks/useAuth';
import { Brain, BarChart3, Loader2, Zap, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { generatePreGameBingo } from '@/lib/bingoEngine';

// --- INTERFACES ---
interface MatchMetrics {
  possession: [number, number];
  xG: [number, number];
  totalShots: [number, number];
  shotsOnTarget: [number, number];
  bigChances: [number, number];
  corners: [number, number];
  offsides: [number, number];
  fouls: [number, number];
  yellowCards: [number, number];
  redCards: [number, number];
}

interface ModelData {
  homeGoalsAvg: number;
  awayGoalsAvg: number;
  homeCornersAvg: number;
  awayCornersAvg: number;
  homeCardsAvg: number;
  awayCardsAvg: number;
}

interface Match {
  id: string | number;
  homeTeam: string;
  awayTeam: string;
  metrics: MatchMetrics;
  modelData: ModelData;
  homeStats?: any;
  awayStats?: any;
  [key: string]: any;
}

interface BingoPick extends Match {
  mercados: { mercado: string; confianca: number }[];
}

const Index = () => {
  const { signOut } = useAuth();
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [bingo, setBingo] = useState<BingoPick[]>([]);
  const [loadingBingo, setLoadingBingo] = useState(false);
  const [hasFetchedOnce, setHasFetchedOnce] = useState(false);

  const { data: rawMatches, isFetching, refetch } = useQuery({
    queryKey: ['matches', date],
    queryFn: () => fetchMatches(date),
    enabled: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  useEffect(() => {
    if (!hasFetchedOnce) {
      refetch();
      setHasFetchedOnce(true);
    }
  }, [refetch, hasFetchedOnce]);

  const safeMatches = useMemo((): Match[] => {
    return (rawMatches || []).map((m: any) => ({
      ...m,
      homeTeam: m.teams?.home?.name || 'Casa',
      awayTeam: m.teams?.away?.name || 'Fora',
      metrics: m.metrics || {
        possession: [0, 0],
        xG: [0, 0],
        totalShots: [0, 0],
        shotsOnTarget: [0, 0],
        bigChances: [0, 0],
        corners: [0, 0],
        offsides: [0, 0],
        fouls: [0, 0],
        yellowCards: [0, 0],
        redCards: [0, 0],
      },
      modelData: m.modelData || {
        homeGoalsAvg: 0,
        awayGoalsAvg: 0,
        homeCornersAvg: 0,
        awayCornersAvg: 0,
        homeCardsAvg: 0,
        awayCardsAvg: 0,
      },
    }));
  }, [rawMatches]);

  // 🔥 BINGO REAL (SEM ALEATORIEDADE)
  const gerarBingo = async () => {
    setLoadingBingo(true);

    if (safeMatches.length === 0) await refetch();

    setTimeout(() => {
      const picks = safeMatches
        .map((m) => {
          const data = generatePreGameBingo(m);
          if (!data) return null;

          const mercados = [];

          const over15 = Number(data.over15);
          const over25 = Number(data.over25);
          const btts = Number(data.btts);

          if (over15 >= 70) {
            mercados.push({
              mercado: "Over 1.5 gols",
              confianca: over15,
            });
          }

          if (over25 >= 60) {
            mercados.push({
              mercado: "Over 2.5 gols",
              confianca: over25,
            });
          }

          if (btts >= 55) {
            mercados.push({
              mercado: "Ambas marcam",
              confianca: btts,
            });
          }

          if (mercados.length === 0) return null;

          return {
            ...m,
            mercados,
          };
        })
        .filter(Boolean)
        .sort((a: any, b: any) => b.mercados.length - a.mercados.length)
        .slice(0, 5);

      setBingo(picks as BingoPick[]);
      setLoadingBingo(false);
    }, 600);
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-white pb-32 font-sans">
      <header className="border-b border-white/10 bg-[#1e293b]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="container max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Brain className="w-8 h-8 text-orange-500" />
            <div>
              <h1 className="text-xl font-bold tracking-tighter">ANALISTA JOILSON</h1>
              <p className="text-[10px] text-orange-500 font-bold uppercase tracking-widest">MODELO REAL PRO</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => refetch()} className="p-2 bg-white/5 rounded-lg">
              <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin text-orange-500' : 'text-gray-400'}`} />
            </button>

            <input 
              type="date" 
              value={date} 
              onChange={(e) => { setDate(e.target.value); setHasFetchedOnce(false); }}
              className="bg-[#334155] text-xs p-2 rounded-lg"
            />

            <button onClick={signOut} className="bg-red-500/10 text-red-500 px-3 py-2 rounded-lg text-xs font-bold">
              SAIR
            </button>
          </div>
        </div>
      </header>

      <main className="container max-w-3xl mx-auto px-4">
        <div className="grid grid-cols-2 gap-4 mt-6">
          <div className="bg-[#1e293b] rounded-xl p-4 text-center">
            <p className="text-xs text-gray-400">Jogos</p>
            <p className="text-3xl font-black text-orange-500">{safeMatches.length}</p>
          </div>

          <button
            onClick={gerarBingo}
            disabled={loadingBingo || isFetching}
            className="bg-green-600 rounded-xl flex flex-col items-center justify-center"
          >
            {loadingBingo ? (
              <Loader2 className="w-6 h-6 animate-spin" />
            ) : (
              <>
                <span className="font-black text-lg">GERAR BINGO</span>
                <span className="text-[10px]">REAL 🔥</span>
              </>
            )}
          </button>
        </div>

        {bingo.length > 0 && (
          <div className="mt-6 bg-gradient-to-br from-orange-600 to-red-700 p-5 rounded-2xl">
            <p className="text-xs font-bold mb-4">BINGO REAL (POISSON)</p>

            {bingo.map((m) => (
              <div key={m.id} className="mb-3 bg-black/20 p-3 rounded-xl">
                <p className="font-bold text-sm mb-2">
                  {m.homeTeam} vs {m.awayTeam}
                </p>

                {m.mercados.map((item, idx) => (
                  <div key={idx} className="flex justify-between text-xs">
                    <span>{item.mercado}</span>
                    <span className="text-green-400 font-bold">
                      {item.confianca}%
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        <div className="mt-8">
          {isFetching ? (
            <Loader2 className="w-10 h-10 animate-spin mx-auto" />
          ) : (
            safeMatches.map((match) => (
              <MatchCard key={match.id} match={match} />
            ))
          )}
        </div>
      </main>

      <div className="fixed bottom-6 left-0 right-0 flex justify-center">
        <Link to="/live" className="bg-orange-600 px-6 py-3 rounded-full flex items-center gap-2">
          <Zap /> LIVE TRADE
        </Link>
      </div>
    </div>
  );
};

export default Index;
