import { Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchLiveMatches } from '@/services/footballApi';

const Live = () => {

  const { data: matches = [], isLoading } = useQuery({
    queryKey: ['live-matches'],
    queryFn: fetchLiveMatches,
    refetchInterval: 15000,
  });

  // 🔥 FILTRO REAL (ANTI-JOGO FAKE)
  const liveMatches = matches.filter((m: any) => {
    const statusShort = m.fixture?.status?.short;
    const statusLong = m.fixture?.status?.long;
    const elapsed = m.fixture?.status?.elapsed;

    // ✔ só entra se tiver minuto rolando
    if (!elapsed || elapsed <= 0) return false;

    // ✔ status válidos reais
    return ['1H', '2H', 'HT'].includes(statusShort) ||
           (statusLong && statusLong.toLowerCase().includes('live'));
  });

  return (
    <div className="min-h-screen bg-background">
      
      <header className="w-full border-b border-border p-4 flex items-center justify-between">
        <h1 className="text-lg font-bold">Jogos Ao Vivo</h1>
        <Link to="/" className="text-sm text-primary hover:underline">
          Voltar
        </Link>
      </header>

      <main className="container max-w-3xl mx-auto px-4 py-6 space-y-6">

        {isLoading && (
          <div className="text-center py-20">
            <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-4" />
            <p className="text-muted-foreground font-medium">
              Buscando jogos ao vivo...
            </p>
          </div>
        )}

        {!isLoading && liveMatches.length === 0 && (
          <div className="text-center py-20">
            <p className="text-muted-foreground">
              Nenhum jogo ao vivo agora.
            </p>
          </div>
        )}

        {!isLoading && liveMatches.length > 0 && (
          <div className="grid gap-4">
            {liveMatches.map((match: any) => {
              const home = match.teams?.home?.name || match.homeTeam || match.home;
              const away = match.teams?.away?.name || match.awayTeam || match.away;
              const minute = match.fixture?.status?.elapsed || '--';

              return (
                <div
                  key={match.id}
                  className="p-4 rounded-xl border border-border bg-card"
                >
                  <p className="font-semibold">
                    🔴 {home} vs {away}
                  </p>

                  <p className="text-sm text-muted-foreground">
                    Minuto: {minute}'
                  </p>
                </div>
              );
            })}
          </div>
        )}

      </main>
    </div>
  );
};

export default Live;
