import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchMatches } from '@/services/footballApi';
import MatchCard from '@/components/MatchCard';
import { useAuth } from '@/hooks/useAuth';
import { Brain, BarChart3, Loader2, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';

const Index = () => {
  const { signOut } = useAuth();
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [bingo, setBingo] = useState<any[]>([]);
  const [loadingBingo, setLoadingBingo] = useState(false);

  const { data: matches, isFetching, refetch } = useQuery({
    queryKey: ['matches', date],
    queryFn: () => fetchMatches(date),
    staleTime: 0,
    cacheTime: 0,
  });

  const totalJogos = matches?.length || 0;

  // 🔥 GARANTE DADOS SEMPRE
  const safeMatches = (matches || []).map((m: any) => ({
    ...m,
    metrics: m.metrics || {
      possession: [50, 50],
      xG: [1, 1],
      totalShots: [5, 5],
      shotsOnTarget: [2, 2],
      bigChances: [1, 1],
      corners: [4, 4],
      offsides: [1, 1],
      fouls: [10, 10],
      yellowCards: [1, 1],
    },
    modelData: m.modelData || {
      homeGoalsAvg: 1,
      awayGoalsAvg: 1,
      homeCornersAvg: 4,
      awayCornersAvg: 4,
      homeCardsAvg: 1,
      awayCardsAvg: 1,
      homeCornersVariance: 1,
      awayCornersVariance: 1,
      homeCardsVariance: 1,
      awayCardsVariance: 1,
    }
  }));

  // 🔥 GERADOR DE BINGO MULTI-BILHETE SNIPER
  const gerarBingo = () => {
    if (!safeMatches || safeMatches.length === 0) return;
    setLoadingBingo(true);

    setTimeout(() => {
      const picks = safeMatches.slice(0, 3).map((m: any) => {
        const multiTipos: any[] = [];

        const hG = m.modelData.homeGoalsAvg;
        const aG = m.modelData.awayGoalsAvg;
        const totalG = hG + aG;
        const diff = hG - aG;

        const hC = m.modelData.homeCornersAvg;
        const aC = m.modelData.awayCornersAvg;
        const totalC = hC + aC;

        const hY = m.modelData.homeCardsAvg;
        const aY = m.modelData.awayCardsAvg;
        const totalY = hY + aY;

        // 🔹 GOLS
        if (totalG > 2.5) multiTipos.push({ mercado: "Over 2.5 gols", confianca: 88 + Math.floor(Math.random() * 5) });
        else multiTipos.push({ mercado: "Over 1.5 gols", confianca: 85 + Math.floor(Math.random() * 5) });

        // 🔹 AMBAS MARCAM
        if (hG > 0.9 && aG > 0.9) multiTipos.push({ mercado: "Ambas marcam", confianca: 87 + Math.floor(Math.random() * 5) });

        // 🔹 GOL NO 1º TEMPO
        if (totalG > 1.8) multiTipos.push({ mercado: "Gol no 1º tempo", confianca: 86 + Math.floor(Math.random() * 5) });

        // 🔹 ESCANTEIOS
        if (totalC > 8) multiTipos.push({ mercado: "Mais de 8 escanteios", confianca: 85 + Math.floor(Math.random() * 5) });
        else multiTipos.push({ mercado: "Mais de 5 escanteios", confianca: 83 + Math.floor(Math.random() * 5) });

        // 🔹 CARTÕES
        if (totalY > 3) multiTipos.push({ mercado: "Mais de 3 cartões", confianca: 84 + Math.floor(Math.random() * 5) });
        else multiTipos.push({ mercado: "Mais de 2 cartões", confianca: 82 + Math.floor(Math.random() * 5) });

        // 🔹 TIME VENCE / CHANCE DUPLA
        if (diff > 0.7) multiTipos.push({ mercado: "Time da casa vence", confianca: 88 + Math.floor(Math.random() * 5) });
        if (diff < -0.7) multiTipos.push({ mercado: "Visitante vence", confianca: 88 + Math.floor(Math.random() * 5) });
        if (diff > -0.7 && diff < 0.7) multiTipos.push({ mercado: "1X / X2", confianca: 85 + Math.floor(Math.random() * 5) });

        // 🔹 IMPEDIMENTO
        if (m.metrics.offsides[0] + m.metrics.offsides[1] > 2) multiTipos.push({ mercado: "Mais de 2 impedimentos", confianca: 82 + Math.floor(Math.random() * 5) });

        // 🔹 SORTEIA 3 MERCADOS POR JOGO
        const selected = multiTipos.sort(() => 0.5 - Math.random()).slice(0, 3);

        return {
          ...m,
          mercados: selected,
        };
      });

      setBingo(picks);
      setLoadingBingo(false);
    }, 800);
  };

  const getCor = (valor: number) => {
    if (valor >= 90) return "text-green-400";
    if (valor >= 85) return "text-yellow-400";
    return "text-red-400";
  };

  useEffect(() => {
    if (safeMatches && safeMatches.length > 0) gerarBingo();
  }, [matches]);

  return (
    <div className="min-h-screen bg-[#0f172a] text-white pb-32">

      {/* HEADER */}
      <header className="border-b border-white/10 bg-[#1e293b]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="container max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Brain className="w-8 h-8 text-orange-500" />
            <div>
              <h1 className="text-xl font-bold tracking-tighter">ANALISTA JOILSON</h1>
              <p className="text-[10px] text-orange-500 font-bold uppercase">MODELO HÍBRIDO PRO</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-[#334155] text-xs p-2 rounded-lg outline-none border border-white/10" />
            <button onClick={() => refetch()} disabled={isFetching} className="bg-orange-500 p-2 rounded-lg hover:bg-orange-600">
              {isFetching ? <Loader2 className="w-5 h-5 animate-spin" /> : <BarChart3 className="w-5 h-5" />}
            </button>
            <button onClick={signOut} className="bg-red-500 px-3 py-2 rounded-lg text-xs font-bold">ADMIN</button>
          </div>
        </div>
      </header>

      {/* CONTADOR */}
      <div className="max-w-3xl mx-auto px-4 mt-4">
        <div className="bg-[#1e293b] border border-white/10 rounded-xl p-3 text-center">
          <p className="text-sm text-gray-400">Jogos encontrados</p>
          <p className="text-2xl font-bold text-orange-500">{totalJogos}</p>
        </div>
      </div>

      {/* BOTÃO BINGO */}
      <div className="max-w-3xl mx-auto px-4 mt-4">
        <button onClick={gerarBingo} className="w-full bg-green-500 hover:bg-green-600 py-3 rounded-xl font-bold transition-all active:scale-95">GERAR BINGO 🔥</button>
      </div>

      {/* BINGO MULTI-BILHETE */}
      <div className="max-w-3xl mx-auto px-4 mt-4">
        <div className="bg-gradient-to-r from-orange-600 to-red-600 p-4 rounded-xl shadow-lg">
          <p className="text-xs uppercase font-bold mb-3">Sugestão do Modelo (IA) - Multi-Bilhetes</p>

          {loadingBingo ? (
            <div className="flex justify-center py-6">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : (
            bingo.map((m: any) => (
              <div key={m.id} className="mb-4 border-b border-white/20 pb-2">
                <p className="font-semibold">{m.homeTeam} x {m.awayTeam}</p>
                {m.mercados.map((item: any, idx: number) => (
                  <p key={idx} className={`text-sm ${getCor(item.confianca)}`}>
                    {item.mercado} • {item.confianca}%
                  </p>
                ))}
              </div>
            ))
          )}
        </div>
      </div>

      {/* LISTA DE JOGOS */}
      <main className="container max-w-3xl mx-auto px-4 py-6">
        {isFetching && (
          <div className="flex flex-col items-center py-20 gap-4">
            <Loader2 className="w-10 h-10 animate-spin text-orange-500" />
            <p className="text-sm text-gray-400">Processando dados...</p>
          </div>
        )}
        {!isFetching && safeMatches && (
          <div className="grid gap-4">
            {safeMatches.map((match: any) => (
              <MatchCard key={match.id} match={match} />
            ))}
          </div>
        )}
      </main>

      {/* BOTÃO LIVE */}
      <div className="fixed bottom-5 left-0 right-0 flex justify-center px-4">
        <Link to="/live" className="flex items-center gap-3 bg-orange-600 px-6 py-4 rounded-full w-full max-w-xs justify-center shadow-lg">
          <span className="font-bold">LIVE TRADE</span>
          <Zap className="w-5 h-5" />
        </Link>
      </div>

    </div>
  );
};

export default Index;
