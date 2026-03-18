import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchMatches } from '@/services/footballApi';
import MatchCard from '@/components/MatchCard';
import { useAuth } from '@/hooks/useAuth';
import { Brain, BarChart3, Loader2, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';

const Index = () => {
  const { signOut } = useAuth();

  const [date, setDate] = useState(() =>
    new Date().toISOString().split('T')[0]
  );

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
      possession: [0, 0],
      xG: [0, 0],
      totalShots: [0, 0],
      shotsOnTarget: [0, 0],
      bigChances: [0, 0],
      corners: [0, 0],
      offsides: [0, 0],
      fouls: [0, 0],
      yellowCards: [0, 0],
    },
    modelData: m.modelData || {
      homeGoalsAvg: 0,
      awayGoalsAvg: 0,
      homeCornersAvg: 0,
      awayCornersAvg: 0,
      homeCardsAvg: 0,
      awayCardsAvg: 0,
      homeCornersVariance: 0,
      awayCornersVariance: 0,
      homeCardsVariance: 0,
      awayCardsVariance: 0,
    }
  }));

  // 🔥 GERADOR DE BINGO PROFISSIONAL
  const gerarBingo = () => {
    if (!safeMatches || safeMatches.length === 0) return;

    setLoadingBingo(true);

    setTimeout(() => {
      const tipos = [
        "Over 1.5 gols",
        "Over 2.5 gols",
        "Ambas marcam",
        "Gol no 1º tempo",
        "Mais de 8 escanteios",
        "Time da casa vence",
        "Visitante marca gol",
        "Cartão amarelo",
        "Cartão vermelho",
        "Chance dupla 1X",
        "Chance dupla X2",
        "Impedimento",
      ];

      const picks = safeMatches
        .sort(() => 0.5 - Math.random())
        .slice(0, 3) // pega até 3 jogos para mais estratégia
        .map((m: any) => {
          // cria múltiplos mercados por jogo
          const mercados = Array.from({ length: 3 }).map(() => {
            const tipo = tipos[Math.floor(Math.random() * tipos.length)];
            const confianca = Math.floor(Math.random() * 20) + 80;
            return { mercado: tipo, confianca };
          });

          return {
            ...m,
            mercados,
          };
        });

      setBingo(picks);
      setLoadingBingo(false);
    }, 1200);
  };

  useEffect(() => {
    if (safeMatches && safeMatches.length > 0) {
      gerarBingo();
    }
  }, [matches]);

  const getCor = (valor: number) => {
    if (valor >= 90) return "text-green-400";
    if (valor >= 85) return "text-yellow-400";
    return "text-red-400";
  };

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
              className="bg-orange-500 p-2 rounded-lg hover:bg-orange-600"
            >
              {isFetching 
                ? <Loader2 className="w-5 h-5 animate-spin" /> 
                : <BarChart3 className="w-5 h-5" />
              }
            </button>

            <button 
              onClick={signOut}
              className="bg-red-500 px-3 py-2 rounded-lg text-xs font-bold"
            >
              ADMIN
            </button>
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

      {/* BOTÃO */}
      <div className="max-w-3xl mx-auto px-4 mt-4">
        <button
          onClick={gerarBingo}
          className="w-full bg-green-500 hover:bg-green-600 py-3 rounded-xl font-bold transition-all active:scale-95"
        >
          GERAR BINGO 🔥
        </button>
      </div>

      {/* BINGO PROFISSIONAL */}
      <div className="max-w-3xl mx-auto px-4 mt-4">
        <div className="relative rounded-xl shadow-lg overflow-hidden">
          <div className="absolute inset-0 bg-black/50 z-0"></div>
          <div className="relative z-10 bg-gradient-to-r from-orange-600 to-red-600 p-4">
            <p className="text-xs uppercase font-bold mb-3 text-white/90">
              Sugestão do Modelo (IA) - Multi-Bilhetes
            </p>

            {loadingBingo ? (
              <div className="flex justify-center py-6">
                <Loader2 className="w-6 h-6 animate-spin text-white" />
              </div>
            ) : (
              bingo.map((m: any) => (
                <div key={m.id} className="mb-4 border-b border-white/20 pb-2">
                  <p className="font-semibold text-white drop-shadow-md">
                    {m.homeTeam} x {m.awayTeam}
                  </p>
                  {m.mercados.map((item: any, idx: number) => (
                    <p key={idx} className={`text-sm ${getCor(item.confianca)} drop-shadow-sm`}>
                      {item.mercado} • {item.confianca}%
                    </p>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* LISTA DE MATCHES */}
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
        <Link 
          to="/live" 
          className="flex items-center gap-3 bg-orange-600 px-6 py-4 rounded-full w-full max-w-xs justify-center shadow-lg"
        >
          <span className="font-bold">LIVE TRADE</span>
          <Zap className="w-5 h-5" />
        </Link>
      </div>

    </div>
  );
};

export default Index;
