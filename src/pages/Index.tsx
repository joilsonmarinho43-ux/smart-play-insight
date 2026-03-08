import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchMatches } from '@/services/footballApi';
import MatchCard from '@/components/MatchCard';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { Calendar, Brain, BarChart3, Loader2, AlertCircle, LogOut, Shield } from 'lucide-react';
import { Link } from 'react-router-dom';

const Index = () => {
  const { signOut } = useAuth();
  const { profile } = useProfile();
  const [date, setDate] = useState(() => {
    const d = new Date();
    return d.toISOString().split('T')[0];
  });

  const { data: matches, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['matches', date],
    queryFn: () => fetchMatches(date),
    enabled: false,
    retry: 1,
    staleTime: 5 * 60 * 1000, // 5 min cache
  });

  const formatDateDisplay = (dateStr: string) => {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('pt-BR', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container max-w-3xl mx-auto px-4 py-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Brain className="w-7 h-7 text-primary" />
            <div>
              <h1 className="font-display text-2xl sm:text-3xl text-foreground tracking-wider leading-none">
                ANALISTA PRO 8.0
              </h1>
              <p className="text-[10px] sm:text-xs text-muted-foreground tracking-widest uppercase">
                Modelo Híbrido Ponderado
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {profile?.is_admin && (
              <Link
                to="/admin"
                className="p-2 rounded-lg text-primary hover:bg-secondary transition-colors"
                title="Painel Admin"
              >
                <Shield className="w-4 h-4" />
              </Link>
            )}
            <button
              onClick={() => signOut()}
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              title="Sair"
            >
              <LogOut className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 bg-secondary rounded-lg px-3 py-2">
              <Calendar className="w-4 h-4 text-primary" />
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="bg-transparent text-foreground text-sm outline-none"
              />
            </div>
            <button
              onClick={() => refetch()}
              disabled={isLoading}
              className="bg-primary text-primary-foreground px-4 py-2 rounded-lg font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <BarChart3 className="w-4 h-4" />
              )}
              {isLoading ? 'Analisando...' : 'Analisar'}
            </button>
          </div>
        </div>
      </header>

      {/* Subtitle bar */}
      <div className="bg-primary/5 border-b border-primary/10">
        <div className="container max-w-3xl mx-auto px-4 py-2.5 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" />
          <span className="text-xs sm:text-sm text-primary font-medium">
            {formatDateDisplay(date)}
            {matches ? ` — ${matches.length} jogos analisados` : ''}
          </span>
        </div>
      </div>

      {/* Content */}
      <main className="container max-w-3xl mx-auto px-4 py-6 space-y-6">
        {!matches && !isLoading && !error && (
          <div className="text-center py-20">
            <Brain className="w-16 h-16 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground text-lg">
              Selecione a data e clique em <strong className="text-primary">Analisar</strong> para gerar a análise profissional.
            </p>
          </div>
        )}

        {isLoading && (
          <div className="text-center py-20">
            <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-4" />
            <p className="text-muted-foreground">Buscando dados ao vivo da API...</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Isso pode levar alguns segundos</p>
          </div>
        )}

        {error && (
          <div className="text-center py-12 bg-destructive/10 rounded-2xl border border-destructive/20 p-6">
            <AlertCircle className="w-10 h-10 text-destructive mx-auto mb-3" />
            <p className="text-destructive font-medium">{(error as Error).message}</p>
            <button
              onClick={() => refetch()}
              className="mt-4 bg-destructive text-destructive-foreground px-4 py-2 rounded-lg text-sm font-medium"
            >
              Tentar novamente
            </button>
          </div>
        )}

        {matches && matches.length === 0 && (
          <div className="text-center py-16">
            <p className="text-muted-foreground text-lg">Nenhum jogo relevante encontrado para esta data.</p>
          </div>
        )}

        {matches && matches.map((match, i) => (
          <div key={match.id} style={{ animationDelay: `${i * 150}ms` }}>
            <MatchCard match={match} />
          </div>
        ))}
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-6">
        <p className="text-center text-xs text-muted-foreground">
          Estatística Histórica + Forma Recente + Ajuste Casa/Fora • Dados via API-Sports.io
        </p>
      </footer>
    </div>
  );
};

export default Index;
