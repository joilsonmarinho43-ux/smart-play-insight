import { useLiveAnalysis } from '@/hooks/useLiveAnalysis';
import LiveMatchCard from '@/components/LiveMatchCard';
import { Loader2, AlertCircle } from 'lucide-react';
import { Link } from 'react-router-dom';

const Live = () => {
  const { data, isLoading, error } = useLiveAnalysis();

  const matches = data || [];

  return (
    <div className="min-h-screen bg-background">
      {/* Header simples (evita erro de build) */}
      <header className="w-full border-b border-border p-4 flex items-center justify-between">
        <h1 className="text-lg font-bold">Ao Vivo</h1>
        <Link to="/" className="text-sm text-primary hover:underline">
          Voltar
        </Link>
      </header>

      <main className="container max-w-3xl mx-auto px-4 py-6 space-y-6">
        
        {isLoading && (
          <div className="text-center py-20">
            <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-4" />
            <p className="text-muted-foreground font-medium">
              Sintonizando jogos ao vivo...
            </p>
          </div>
        )}

        {error && (
          <div className="text-center py-12 bg-destructive/10 rounded-2xl border border-destructive/20 p-6">
            <AlertCircle className="w-10 h-10 text-destructive mx-auto mb-3" />
            <p className="text-destructive font-medium">
              {(error as Error).message}
            </p>
          </div>
        )}

        {!isLoading && matches.length === 0 && (
          <div className="text-center py-20 bg-secondary/20 rounded-2xl border border-dashed border-border">
            <p className="text-muted-foreground">
              Não há jogos ao vivo agora.
            </p>
            <Link
              to="/"
              className="text-primary text-sm mt-4 inline-block hover:underline"
            >
              Voltar para Pré-Jogo
            </Link>
          </div>
        )}

        {matches.length > 0 && (
          <div className="grid gap-6">
            {matches.map((match: any) => (
              <LiveMatchCard key={match.id} match={match} />
            ))}
          </div>
        )}

      </main>
    </div>
  );
};

export default Live;
