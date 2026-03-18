import { Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchLiveMatches } from '@/services/footballApi';

const Live = () => {

  const { data: matches = [], isLoading, isError } = useQuery({
    queryKey: ['live-matches'],
    queryFn: fetchLiveMatches,
    refetchInterval: 15000,
  });

  // 🔥 FILTRO SEGURO (SEM QUEBRAR)
  const liveMatches = (matches || []).filter((m: any) => {
    const statusShort = m?.fixture?.status?.short || m?.status || '';
    const elapsed = m?.fixture?.status?.elapsed || m?.minute || 0;

    return (
      elapsed > 0 &&
      ['1H', '2H', 'HT', 'LIVE'].includes(statusShort)
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

        {/* ERRO CONTROLADO */}
        {isError && (
          <div className="text-center py-20">
            <p className="text-red-400 font-medium">
              Erro ao carregar jogos ao vivo.
            </p>
          </div>
        )}

        {isLoading && (
          <div className="text-center py-20">
            <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-4" />
            <p className="text-muted-foreground font-medium">
              Buscando jogos ao vivo...
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
