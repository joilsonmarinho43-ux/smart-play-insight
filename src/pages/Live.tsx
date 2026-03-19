import { Loader2, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchMatches, fetchMatchStats } from '@/services/footballApi';

const calculatePressure = (stats: any, side: 'home' | 'away') => {
  if (!stats) return 0;

  const shotsOnGoal = stats[side]?.shotsOnGoal || 0;
  const dangerousAttacks = stats[side]?.dangerousAttacks || 0;
  const corners = stats[side]?.corners || 0;

  return (shotsOnGoal * 2) + (dangerousAttacks * 1.5) + (corners * 1.2);
};

const Live = () => {

  const { data: matches = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['live-matches'],
    queryFn: () => fetchMatches('live'),
    refetchInterval: 60000,
    staleTime: 30000,
  });

  const { data: statsMap = {} } = useQuery({
    queryKey: ['live-stats', matches],
    queryFn: async () => {
      const stats: any = {};

      for (const match of matches) {
        const id = match?.fixture?.id;
        if (!id) continue;

        stats[id] = await fetchMatchStats(id);
      }

      return stats;
    },
    enabled: matches.length > 0,
    refetchInterval: 60000,
  });

  return (
    <div className="min-h-screen bg-background text-foreground">

      <header className="p-4 flex justify-between items-center border-b">
        <h1 className="font-bold">🔥 Live Trader</h1>

        <button onClick={() => refetch()} className="flex gap-2 items-center text-xs">
          <RefreshCw className={isFetching ? 'animate-spin' : ''} size={14}/>
          Atualizar
        </button>
      </header>

      <main className="p-4 space-y-4">

        {isLoading && (
          <Loader2 className="animate-spin mx-auto"/>
        )}

        {matches.map((match: any) => {
          const id = match?.fixture?.id;
          const stats = statsMap[id];

          const homePressure = calculatePressure(stats, 'home');
          const awayPressure = calculatePressure(stats, 'away');

          const diff = homePressure - awayPressure;

          let signal = '🟢 Equilibrado';
          if (diff > 15) signal = '🔴 Pressão Mandante';
          if (diff < -15) signal = '🔴 Pressão Visitante';

          return (
            <div key={id} className="p-4 border rounded-xl">

              <div className="flex justify-between mb-2">
                <span>{match.teams.home.name} vs {match.teams.away.name}</span>
                <span>{match.fixture.status.elapsed}'</span>
              </div>

              <div className="flex justify-between text-sm">
                <span>Pressão Casa: {homePressure.toFixed(1)}</span>
                <span>Pressão Fora: {awayPressure.toFixed(1)}</span>
              </div>

              <div className="mt-2 text-center font-bold">
                {signal}
              </div>

            </div>
          );
        })}

      </main>
    </div>
  );
};

export default Live;
