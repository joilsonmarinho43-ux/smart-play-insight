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

  // 🔥 NORMALIZA DADOS
  const safeMatches = (matches || []).map((m: any) => ({
    ...m,
    metrics: m.metrics || {
      xG: [0, 0],
      totalShots: [0, 0],
      corners: [0, 0],
    },
    modelData: m.modelData || {
      homeGoalsAvg: 1,
      awayGoalsAvg: 1,
    }
  }));

  // =========================
  // 🔥 MODO SNIPER PROFISSIONAL
  // =========================
  const gerarBingo = () => {
    if (!safeMatches.length) return;

    setLoadingBingo(true);

    const poisson = (lambda: number, k: number) => {
      let e = Math.exp(-lambda);
      let pow = Math.pow(lambda, k);
      let fact = 1;
      for (let i = 1; i <= k; i++) fact *= i;
      return (pow * e) / fact;
    };

    const probOver25 = (lambda: number) => {
      let prob = 0;
      for (let i = 0; i <= 2; i++) prob += poisson(lambda, i);
      return (1 - prob) * 100;
    };

    const probBTTS = (h: number, a: number) => {
      const pH0 = poisson(h, 0);
      const pA0 = poisson(a, 0);
      return (1 - (pH0 + pA0 - pH0 * pA0)) * 100;
    };

    const probHT = (lambda: number) => {
      return (1 - poisson(lambda * 0.45, 0)) * 100;
    };

    const odd = (prob: number) => (100 / prob) * 1.08;

    setTimeout(() => {

      const picks = safeMatches
        .map((m: any) => {

          const home = m.metrics.xG[0] || m.modelData.homeGoalsAvg || 1;
          const away = m.metrics.xG[1] || m.modelData.awayGoalsAvg || 1;

          const total = home + away;
          const diff = home - away;

          const shots = (m.metrics.totalShots[0] || 8) + (m.metrics.totalShots[1] || 8);

          const jogoDesequilibrado = Math.abs(diff) > 0.8;
          const pressaoAlta = shots > 18;

          const over25 = probOver25(total);
          const btts = probBTTS(home, away);
          const golHT = probHT(total);

          let mercado: any = null;

          // 🎯 LÓGICA SNIPER
          if (jogoDesequilibrado && home > away) {
            mercado = {
              tipo: "Time da casa vence",
              prob: 75 + diff * 10
            };
          }

          if (!mercado && pressaoAlta) {
            mercado = {
              tipo: "Gol no 1º tempo",
              prob: golHT
            };
          }

          if (!mercado && total > 2.6) {
            mercado = {
              tipo: "Over 2.5 gols",
              prob: over25
            };
          }

          if (!mercado) {
            mercado = {
              tipo: "Ambas marcam",
              prob: btts
            };
          }

          const oddCasa = odd(mercado.prob);
          const oddJusta = 100 / mercado.prob;
          const value = oddCasa - oddJusta;

          // 🔥 FILTRO PROFISSIONAL
          if (mercado.prob < 70 || value < 0.05) return null;

          return {
            ...m,
            tipo: mercado.tipo,
            confianca: Math.min(90, Math.round(mercado.prob)),
            odd: oddCasa.toFixed(2),
            value: value.toFixed(2),
          };

        })
        .filter(Boolean)
        .sort((a: any, b: any) => b.value - a.value)
        .slice(0, 2);

      setBingo(picks);
      setLoadingBingo(false);

    }, 500);
  };

  useEffect(() => {
    if (safeMatches.length > 0) gerarBingo();
  }, [matches]);

  const getCor = (valor: number) => {
    if (valor >= 85) return "text-green-400";
    if (valor >= 75) return "text-yellow-400";
    return "text-red-400";
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-white pb-32">

      <header className="border-b border-white/10 bg-[#1e293b]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="container max-w-3xl mx-auto px-4 py-4 flex justify-between">

          <div className="flex items-center gap-3">
            <Brain className="w-8 h-8 text-orange-500" />
            <div>
              <h1 className="text-xl font-bold">ANALISTA JOILSON</h1>
              <p className="text-[10px] text-orange-500 font-bold">
                MODO SNIPER PRO
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <input 
              type="date" 
              value={date} 
              onChange={(e) => setDate(e.target.value)}
              className="bg-[#334155] text-xs p-2 rounded-lg"
            />

            <button onClick={() => refetch()} className="bg-orange-500 p-2 rounded-lg">
              {isFetching ? <Loader2 className="animate-spin" /> : <BarChart3 />}
            </button>

            <button onClick={signOut} className="bg-red-500 px-3 py-2 rounded-lg text-xs">
              ADMIN
            </button>
          </div>

        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 mt-4 text-center">
        <p className="text-gray-400">Jogos encontrados</p>
        <p className="text-2xl text-orange-500 font-bold">{totalJogos}</p>
      </div>

      <div className="max-w-3xl mx-auto px-4 mt-4">
        <button onClick={gerarBingo} className="w-full bg-green-500 py-3 rounded-xl font-bold">
          GERAR BINGO 🔥
        </button>
      </div>

      <div className="max-w-3xl mx-auto px-4 mt-4">
        <div className="bg-gradient-to-r from-orange-600 to-red-600 p-4 rounded-xl">

          <p className="text-xs font-bold mb-3">Sugestão do Modelo (IA)</p>

          {loadingBingo ? (
            <Loader2 className="animate-spin mx-auto" />
          ) : (
            bingo.map((m: any) => (
              <div key={m.id} className="mb-3 border-b border-white/20 pb-2">

                <p>{m.homeTeam} x {m.awayTeam}</p>

                <p className={getCor(m.confianca)}>
                  {m.tipo} • {m.confianca}% | Odd {m.odd} | EV {m.value}
                </p>

              </div>
            ))
          )}

        </div>
      </div>

      <main className="container max-w-3xl mx-auto px-4 py-6">
        {!isFetching && safeMatches.map((match: any) => (
          <MatchCard key={match.id} match={match} />
        ))}
      </main>

      <div className="fixed bottom-5 left-0 right-0 flex justify-center px-4">
        <Link to="/live" className="bg-orange-600 px-6 py-4 rounded-full flex gap-2">
          LIVE TRADE <Zap />
        </Link>
      </div>

    </div>
  );
};

export default Index;
