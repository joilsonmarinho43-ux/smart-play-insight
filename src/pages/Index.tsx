import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchMatches } from '@/services/footballApi';
import MatchCard from '@/components/MatchCard';
import { useAuth } from '@/hooks/useAuth';
import { Brain, BarChart3, Loader2, Zap, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';

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
  
  // TRAVA DE SEGURANÇA: Impede disparos ao minimizar/voltar
  const [hasFetchedOnce, setHasFetchedOnce] = useState(false);

  // ✅ CONFIGURAÇÃO MANUAL (ZERO AUTOMATISMO)
  const { data: rawMatches, isFetching, refetch } = useQuery({
    queryKey: ['matches', date],
    queryFn: () => fetchMatches(date),
    enabled: false,              // 🛑 BLOQUEIO TOTAL: Não busca sozinho NUNCA
    staleTime: Infinity,         // O dado nunca fica "velho" para o React
    refetchOnWindowFocus: false, // Não reativa ao voltar para a aba
    refetchOnMount: false,       // Não reativa ao navegar entre páginas
    refetchOnReconnect: false,   // Não reativa se a internet oscilar
  });

  // Gatilho controlado: Só corre uma vez no carregamento inicial real
  useEffect(() => {
    if (!hasFetchedOnce) {
      refetch();
      setHasFetchedOnce(true);
    }
  }, [refetch, hasFetchedOnce]);

  const safeMatches = useMemo((): Match[] => {
    return (rawMatches || []).map((m: any) => ({
      ...m,
      metrics: m.metrics || { possession: [0, 0], xG: [0, 0], totalShots: [0, 0], shotsOnTarget: [0, 0], bigChances: [0, 0], corners: [0, 0], offsides: [0, 0], fouls: [0, 0], yellowCards: [0, 0], redCards: [0, 0] },
      modelData: m.modelData || { homeGoalsAvg: 0, awayGoalsAvg: 0, homeCornersAvg: 0, awayCornersAvg: 0, homeCardsAvg: 0, awayCardsAvg: 0 },
    }));
  }, [rawMatches]);

  const calcularConfianca = (m: Match, tipo: string): number => {
    const { metrics, modelData } = m;
    let score = 85;
    switch (tipo) {
      case "Over 1.5 gols": score = (modelData.homeGoalsAvg + modelData.awayGoalsAvg) * 40 + 60; break;
      case "Ambas marcam": score = (metrics.totalShots[0] > 5 ? 50 : 0) + (metrics.totalShots[1] > 5 ? 50 : 0); break;
      case "Mais de 8 escanteios": score = (metrics.corners[0] + metrics.corners[1]) * 5; break;
      default: score = 85;
    }
    return Math.min(100, Math.round(score));
  };

  const gerarBingo = async () => {
    setLoadingBingo(true);
    // Se a lista estiver vazia por algum motivo, forçamos o refetch manual aqui
    if (safeMatches.length === 0) await refetch();

    setTimeout(() => {
      const tipos = ["Over 1.5 gols", "Over 2.5 gols", "Ambas marcam", "Gol no 1º tempo", "Mais de 8 escanteios", "Time da casa vence"];
      const picks = [...safeMatches].sort(() => 0.5 - Math.random()).slice(0, 3).map((m) => ({
        ...m,
        mercados: [...tipos].sort(() => 0.5 - Math.random()).slice(0, 3).map((tipo) => ({
          mercado: tipo,
          confianca: calcularConfianca(m, tipo),
        })),
      }));
      setBingo(picks);
      setLoadingBingo(false);
    }, 800);
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-white pb-32 font-sans">
      <header className="border-b border-white/10 bg-[#1e293b]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="container max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Brain className="w-8 h-8 text-orange-500" />
            <div>
              <h1 className="text-xl font-bold tracking-tighter">ANALISTA JOILSON</h1>
              <p className="text-[10px] text-orange-500 font-bold uppercase tracking-widest">MODELO HÍBRIDO PRO</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => refetch()} 
              className="p-2 bg-white/5 rounded-lg hover:bg-white/10 transition-colors"
              title="Atualizar Dados Manualmente"
            >
              <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin text-orange-500' : 'text-gray-400'}`} />
            </button>
            <input 
              type="date" 
              value={date} 
              onChange={(e) => { setDate(e.target.value); setHasFetchedOnce(false); }}
              className="bg-[#334155] text-xs p-2 rounded-lg outline-none border border-white/10"
            />
            <button onClick={signOut} className="bg-red-500/10 text-red-500 border border-red-500/20 px-3 py-2 rounded-lg text-xs font-bold">SAIR</button>
          </div>
        </div>
      </header>

      <main className="container max-w-3xl mx-auto px-4">
        <div className="grid grid-cols-2 gap-4 mt-6">
          <div className="bg-[#1e293b] border border-white/10 rounded-xl p-4 text-center">
            <p className="text-xs text-gray-400 uppercase font-semibold">Jogos Disponíveis</p>
            <p className="text-3xl font-black text-orange-500">{safeMatches.length}</p>
          </div>
          <button
            onClick={gerarBingo}
            disabled={loadingBingo || isFetching}
            className="bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded-xl flex flex-col items-center justify-center transition-all active:scale-95 border-b-4 border-green-800"
          >
            {loadingBingo ? <Loader2 className="w-6 h-6 animate-spin" /> : <><span className="font-black text-lg">GERAR BINGO</span><span className="text-[10px] opacity-80">SNIPER REAL 🔥</span></>}
          </button>
        </div>

        {bingo.length > 0 && (
          <div className="mt-6 relative rounded-2xl overflow-hidden border border-orange-500/30 shadow-[0_0_20px_rgba(249,115,22,0.15)]">
            <div className="bg-gradient-to-br from-orange-600 to-red-700 p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs uppercase font-black tracking-widest text-white/90">Sugestão Sniper (IA)</p>
                <BarChart3 className="w-4 h-4 text-white/70" />
              </div>
              <div className="space-y-3">
                {bingo.map((m) => (
                  <div key={m.id} className="bg-black/20 backdrop-blur-sm p-3 rounded-xl border border-white/10">
                    <p className="font-bold text-sm mb-2">{m.homeTeam} vs {m.awayTeam}</p>
                    <div className="grid grid-cols-1 gap-1">
                      {m.mercados.map((item, idx) => (
                        <div key={idx} className="flex justify-between items-center text-xs">
                          <span className="text-white/80">{item.mercado}</span>
                          <span className={`font-mono font-bold ${item.confianca >= 90 ? 'text-green-400' : 'text-yellow-300'}`}>{item.confianca}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="mt-8">
          <h2 className="text-sm font-bold text-gray-400 uppercase mb-4 px-1">Análise de Mercado</h2>
          {isFetching ? (
            <div className="flex flex-col items-center py-12">
              <Loader2 className="w-10 h-10 animate-spin text-orange-500 mb-2" />
              <p className="text-xs text-gray-500">Sincronizando com servidores de elite...</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {safeMatches.map((match) => <MatchCard key={match.id} match={match} />)}
            </div>
          )}
        </div>
      </main>

      <div className="fixed bottom-6 left-0 right-0 flex justify-center px-4 z-40">
        <Link to="/live" className="flex items-center gap-3 bg-orange-600 hover:bg-orange-500 px-8 py-4 rounded-full w-full max-w-xs justify-center shadow-2xl transition-transform active:scale-95 border-t border-white/20">
          <Zap className="w-5 h-5 fill-current" />
          <span className="font-black tracking-tighter">LIVE TRADE PRO</span>
        </Link>
      </div>
    </div>
  );
};

export default Index;
        
