import { Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchMatches } from '@/services/footballApi';

const Live = () => {

  const { data: matches = [], isLoading, isError } = useQuery({
    queryKey: ['live-matches'],
    queryFn: () => fetchMatches(new Date().toISOString().split('T')[0]),
    refetchInterval: 15000,
  });

  // 🔥 FILTRO MAIS SEGURO POSSÍVEL
  const liveMatches = (matches || []).filter((m: any) => {
    const status = (
      m?.fixture?.status?.short ||
      m?.status ||
      ''
    ).toString().toLowerCase();

    const minute =
      m?.fixture?.status?.elapsed ||
      m?.minute ||
      0;

    return (
      minute > 0 &&
      (
        status.includes('1h') ||
        status.includes('2h') ||
        status.includes('live') ||
        status.includes('playing')
      )
    );
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

        {isError && (
          <div className="text-center py-20">
            <p className="text-red-400 font-medium">
              Erro ao carregar jogos.
            </p>
          </div>
        )}

        {isLoading && (
          <div className="text-center py-20">
            <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-4" />
            <p className="text-muted-foreground font-medium">
              Buscando jogos...
            </p>
          </div>
        )}

        {!isLoading && !isError && liveMatches.length === 0 && (
          <div className="text-center py-20">
            <p className="text-muted-foreground">
              Nenhum jogo ao vivo agora.
            </p>
          </div>
        )}

        {!isLoading && liveMatches.length > 0 && (
          <div className="grid gap-4">
            {liveMatches.map((match: any, index: number) => {

              const home =
                match?.teams?.home?.name ||
                match?.homeTeam ||
                match?.home ||
                'Time A';

              const away =
                match?.teams?.away?.name ||
                match?.awayTeam ||
                match?.away ||
                'Time B';

              const minute =
                match?.fixture?.status?.elapsed ||
                match?.minute ||
                '--';

              return (
                <div
                  key={match?.id || index}
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
