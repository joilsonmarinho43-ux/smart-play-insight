import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchMatches } from '@/services/footballApi';
import MatchCard from '@/components/MatchCard';
import { useAuth } from '@/hooks/useAuth';
import { Brain, Loader2, Zap, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { generatePreGameBingo } from '@/lib/bingoEngine';

interface MatchMetrics { ... } // igual ao código que você já tem
interface ModelData { ... }
interface Match { ... }
interface BingoPick extends Match { mercados: { mercado: string; confianca: number }[] }

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
  });

  useEffect(() => { if (!hasFetchedOnce) { refetch(); setHasFetchedOnce(true); } }, [refetch, hasFetchedOnce]);

  const safeMatches = useMemo(() => (rawMatches || []).map((m: any) => ({
    ...m,
    homeTeam: m.teams?.home?.name || 'Casa',
    awayTeam: m.teams?.away?.name || 'Fora',
    metrics: m.metrics || { totalShots: [0,0], corners: [0,0], yellowCards: [0,0], offsides: [0,0] },
    modelData: m.modelData || { homeGoalsAvg: 1.2, awayGoalsAvg: 1.0, homeCornersAvg: 4, awayCornersAvg: 4, homeCardsAvg: 2, awayCardsAvg: 2 },
  })), [rawMatches]);

  const gerarBingo = async () => {
    setLoadingBingo(true);
    if (safeMatches.length === 0) await refetch();
    setTimeout(() => {
      const picks = safeMatches.map((m) => {
        const data = generatePreGameBingo(m);
        if (!data) return null;
        return { ...m, mercados: data.markets.map(mk => ({ mercado: mk.market, confianca: mk.probability })) };
      }).filter(Boolean).slice(0,5);
      setBingo(picks as BingoPick[]);
      setLoadingBingo(false);
    }, 600);
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-white pb-32 font-sans">
      <header className="border-b border-white/10 bg-[#1e293b]/80 sticky top-0 z-50">
        <div className="container max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3"><Brain className="w-8 h-8 text-orange-500" /><div><h1 className="text-xl font-bold">ANALISTA JOILSON</h1><p className="text-[10px] text-orange-500 font-bold uppercase">MODELO REAL PRO</p></div></div>
          <div className="flex items-center gap-2">
            <button onClick={() => refetch()} className="p-2 bg-white/5 rounded-lg"><RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin text-orange-500' : 'text-gray-400'}`} /></button>
            <input type="date" value={date} onChange={e => { setDate(e.target.value); setHasFetchedOnce(false); }} className="bg-[#334155] text-xs p-2 rounded-lg" />
            <button onClick={signOut} className="bg-red-500/10 text-red-500 px-3 py-2 rounded-lg text-xs font-bold">SAIR</button>
          </div>
        </div>
      </header>

      <main className="container max-w-3xl mx-auto px-4">
        <div className="grid grid-cols-2 gap-4 mt-6">
          <div className="bg-[#1e293b] rounded-xl p-4 text-center"><p className="text-xs text-gray-400">Jogos</p><p className="text-3xl font-black text-orange-500">{safeMatches.length}</p></div>
          <button onClick={gerarBingo} disabled={loadingBingo || isFetching} className="bg-green-600 rounded-xl flex flex-col items-center justify-center">
            {loadingBingo ? <Loader2 className="w-6 h-6 animate-spin" /> : <><span className="font-black text-lg">GERAR BINGO</span><span className="text-[10px]">REAL 🔥</span></>}
          </button>
        </div>

        {bingo.length > 0 && <div className="mt-6 bg-gradient-to-br from-orange-600 to-red-700 p-5 rounded-2xl">
          {bingo.map((m) => (<div key={m.id} className="mb-3 bg-black/20 p-3 rounded-xl">
            <p className="font-bold text-sm mb-2">{m.homeTeam} vs {m.awayTeam}</p>
            {m.mercados.map((item, idx) => (<div key={idx} className="flex justify-between text-xs"><span>{item.mercado}</span><span className="text-green-400 font-bold">{item.confianca}%</span></div>))}
          </div>))}
        </div>}

        <div className="mt-8">{safeMatches.map(match => <MatchCard key={match.id} match={match} />)}</div>
      </main>

      <div className="fixed bottom-6 left-0 right-0 flex justify-center"><Link to="/live" className="bg-orange-600 px-6 py-3 rounded-full flex items-center gap-2"><Zap /> LIVE TRADE</Link></div>
    </div>
  );
};

export default Index;
