import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowLeft, Crosshair, Loader2 } from 'lucide-react';
import { fetchMultiDayMatches } from '@/services/footballApi';
import { isWorldCupLeague } from '@/lib/worldCupLeagues';
import { localizeTeamName } from '@/lib/teamI18n';
import { useScannerEnrichment } from '@/hooks/useScannerEnrichment';
import ScannerProPanel from '@/components/ScannerProPanel';
import bgPattern from '@/assets/bg-circuit-pattern.jpg';


const Scanner = () => {
  const { data: matches = [], isLoading } = useQuery({
    queryKey: ['matches-multiday'],
    queryFn: () => fetchMultiDayMatches(6),
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30,
  });

  const safeMatches = useMemo(() => (matches || [])
    .filter((m: any) => !isWorldCupLeague(m.league))
    .map((m: any) => ({
      ...m,
      homeTeam: localizeTeamName(m.teams?.home?.name || m.homeTeam) || 'Casa',
      awayTeam: localizeTeamName(m.teams?.away?.name || m.awayTeam) || 'Fora',
      league: m.league?.name || m.league || '',
      // Preserva a data/hora original (ISO) para o scanner exibir dia e horário
      kickoff: m.fixture?.date || m.kickoff || m.date || m.utcDate || m.time || null,
      time: m.fixture?.date
        ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Belem', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(m.fixture.date))
        : m.time || '',
    })), [matches]);

  // Busca os últimos jogos reais de cada equipe para o modelo não cair na
  // média da liga (o que deixava todos os jogos com números idênticos).
  const { matches: enrichedMatches, isEnriching, enrichedCount } = useScannerEnrichment(safeMatches);



  return (
    <div className="min-h-screen text-white pb-8 font-sans relative">
      <div
        className="fixed inset-0 z-0"
        style={{ backgroundImage: `url(${bgPattern})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
      />
      <div className="fixed inset-0 z-0 bg-black/50" />

      <main className="container max-w-3xl lg:max-w-6xl xl:max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 pt-4">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <Link to="/" className="p-2 bg-black/30 rounded-lg hover:bg-black/50">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <Crosshair className="w-6 h-6 text-orange-500" />
          <h1 className="text-xl font-black uppercase tracking-wider">Scanner PRO</h1>
          {isEnriching && (
            <div className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-orange-500/10 border border-orange-500/20 text-[11px] text-orange-300">
              <Loader2 className="w-3 h-3 animate-spin text-orange-400" />
              <span>Calibrando histórico real...</span>
            </div>
          )}
        </div>

        {isLoading ? (
          <p className="text-center text-muted-foreground py-8">Carregando jogos...</p>
        ) : (
          <ScannerProPanel matches={enrichedMatches} />
        )}
      </main>
    </div>
  );
};

export default Scanner;
