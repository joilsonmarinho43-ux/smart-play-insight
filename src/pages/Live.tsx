import { Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchMatches } from '@/services/footballApi';

const Live = () => {
  // Chamada da API configurada para monitoramento em tempo real
  const { data: matches = [], isLoading, isError } = useQuery({
    queryKey: ['live-matches'],
    queryFn: () => fetchMatches(new Date().toISOString().split('T')[0]),
    
    // --- CONFIGURAÇÕES ESPECÍFICAS PARA O LIVE ---
    refetchInterval: 30000,       // Atualiza a cada 30 segundos (Equilíbrio entre precisão e economia)
    refetchOnWindowFocus: true,   // Força a atualização ao voltar para a aba (Sobrescreve o App.tsx)
    staleTime: 0,                 // O dado do Live é considerado "vencido" imediatamente
    // ---------------------------------------------
  });

  // FILTRO DE JOGOS AO VIVO (Normalização de dados da API-Football)
  const liveMatches = (matches || []).filter((m: any) => {
    // Busca o status em diferentes caminhos possíveis da resposta da API
    const status = (
      m?.fixture?.status?.short || 
      m?.status || 
      ''
    ).toString().toUpperCase();

    const minute = m?.fixture?.status?.elapsed || m?.minute || 0;

    // Filtra apenas o que está em andamento (1º Tempo, 2º Tempo ou Live genérico)
    return (
      minute > 0 &&
      (
        status === '1H' || 
        status === '2H' || 
        status === 'LIVE' || 
        status === 'HT' || // Intervalo também é considerado Live para análise
        status === 'P'     // Penaltis
      )
    );
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      
      <header className="w-full border-b border-border p-4 flex items-center justify-between sticky top-0 bg-background/80 backdrop-blur-sm z-10">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          <h1 className="text-lg font-bold">Monitoramento Live</h1>
        </div>
        <Link to="/" className="text-sm font-medium text-primary hover:opacity-80 transition-opacity">
          Voltar para Home
        </Link>
      </header>

      <main className="container max-w-3xl mx-auto px-4 py-6">

        {isError && (
          <div className="text-center py-20 border border-dashed border-red-900/30 rounded-2xl">
            <p className="text-red-400 font-medium">
              Erro na conexão com a API de Futebol.
            </p>
          </div>
        )}

        {isLoading && (
          <div className="text-center py-20">
            <Loader2 className="w-10 h-10 text-primary animate-spin mx-auto mb-4" />
            <p className="text-muted-foreground animate-pulse">
              Sincronizando dados em tempo real...
            </p>
          </div>
        )}

        {!isLoading && !isError && liveMatches.length === 0 && (
          <div className="text-center py-20 opacity-60">
            <p className="text-muted-foreground">
              Nenhuma partida compatível com o filtro "Live" no momento.
            </p>
          </div>
        )}

        {!isLoading && liveMatches.length > 0 && (
          <div className="grid gap-3">
            {liveMatches.map((match: any, index: number) => {
              // Extração segura dos nomes dos times
              const home = match?.teams?.home?.name || match?.homeTeam || 'Mandante';
              const away = match?.teams?.away?.name || match?.awayTeam || 'Visitante';
              
              // Placar
              const homeGoals = match?.goals?.home ?? 0;
              const awayGoals = match?.goals?.away ?? 0;

              const minute = match?.fixture?.status?.elapsed || match?.minute || '--';

              return (
                <div
                  key={match?.fixture?.id || match?.id || index}
                  className="p-5 rounded-xl border border-border bg-card hover:border-primary/50 transition-colors shadow-sm"
                >
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs font-bold text-red-500 bg-red-500/10 px-2 py-0.5 rounded uppercase">
                      {match?.fixture?.status?.short || 'Live'}
                    </span>
                    <span className="text-sm font-mono text-primary">
                      {minute}' min
                    </span>
                  </div>

                  <div className="flex justify-between items-center">
                    <div className="flex-1 text-left font-semibold text-sm sm:text-base">
                      {home}
                    </div>
                    
                    <div className="px-4 flex gap-2 font-bold text-lg">
                      <span>{homeGoals}</span>
                      <span className="opacity-30">-</span>
                      <span>{awayGoals}</span>
                    </div>

                    <div className="flex-1 text-right font-semibold text-sm sm:text-base">
                      {away}
                    </div>
                  </div>
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
                  
