import { useQuery } from '@tanstack/react-query';
import { fetchLiveMatches } from '@/services/footballApi';
import LiveMatchCard from '@/components/LiveMatchCard';
import { Brain, Loader2, AlertCircle, ArrowLeft, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';

const Live = () => {

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['live-matches'],
    queryFn: fetchLiveMatches,
    refetchInterval: 60000,
    retry: 1,
  });

  // 🔥 TRATAMENTO SEGURO (ESSA É A CORREÇÃO)
  const matches = Array.isArray(data)
    ? data
    : Array.isArray(data?.response)
    ? data.response
    : Array.isArray(data?.data)
    ? data.data
    : [];

  return (
    <div className="min-h-screen bg-background">

      {/* Header */}
      <header className="border-b border-primary/20 bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">

          <div className="flex items-center gap-3">
            <Link to="/" className="p-2 hover:bg-secondary rounded-lg transition-colors">
              <ArrowLeft className="w-5 h-5 text-muted-foreground" />
            </Link>

            <div>
              <h1 className="font-display text-xl sm:text-2xl text-foreground tracking-wider leading-none flex items-center gap-2">
                <Zap className="w-5 h-5 text-primary animate-pulse" />
                TRADE AO VIVO
              </h1>

              <p className="text-[10px] text-primary uppercase tracking-widest font-bold">
                Monitor de Pressão em Tempo Real
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isFetching && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
            <span className="text-[10px] bg-secondary px-2 py-1 rounded text-muted-foreground font-mono">
              AUTO-REFRESH: 60s
            </span>
          </div>

        </div>
      </header>

      <main className="container max-w-3xl mx-auto px-4 py-6 space-y-6">

        {/* LOADING */}
        {isLoading && (
          <div className="text-center py-20">
            <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-4" />
            <p className="text-muted-foreground font-medium">
              Sintonizando jogos em andamento...
            </p>
          </div>
        )}

        {/* ERRO */}
        {error && (
          <div className="text-center py-12 bg-destructive/10 rounded-2xl border border-destructive/20 p-6">
            <AlertCircle className="w-10 h-10 text-destructive mx-auto mb-3" />
            <p className="text-destructive font-medium">
              {(error as Error).message}
            </p>
          </div>
        )}

        {/* SEM JOGOS */}
        {!isLoading && matches.length === 0 && (
          <div className="text-center py-20 bg-secondary/20 rounded-2xl border border-dashed border-border">
            <Brain className="w-16 h-16 text-muted-foreground/20 mx-auto mb-4" />
            <p className="text-muted-foreground">
              Não há jogos das suas ligas principais acontecendo agora.
            </p>

            <Link to="/" className="text-primary text-sm mt-4 inline-block hover:underline">
              Voltar para Pré-Jogo
            </Link>
          </div>
        )}

        {/* JOGOS LIVE */}
        {!isLoading && matches.length > 0 && (
          <div className="grid gap-6">
            {matches.map((match: any) => (
              <LiveMatchCard key={match.id} match={match} />
            ))}
          </div>
        )}

      </main>

      <footer className="py-8 text-center">
        <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
          Analista Joilson • Modo Scalping & Pressure Index
        </p>
      </footer>

    </div>
  );
};

export default Live;
