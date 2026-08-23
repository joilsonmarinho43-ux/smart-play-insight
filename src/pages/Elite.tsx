import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowLeft, Crown } from 'lucide-react';
import { fetchMultiDayMatches } from '@/services/footballApi';
import { isWorldCupLeague } from '@/lib/worldCupLeagues';
import { localizeTeamName } from '@/lib/teamI18n';
import ElitePanel from '@/components/ElitePanel';
import { useScannerEnrichment } from '@/hooks/useScannerEnrichment';
import { isPremiumLeague } from '@/lib/premiumLeagues';
import bgPattern from '@/assets/bg-circuit-pattern.jpg';

const Elite = () => {
  const { data: matches = [], isLoading } = useQuery({
    queryKey: ['matches-multiday'],
    queryFn: () => fetchMultiDayMatches(6),
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30,
  });

  const fmt = (v: any, withDate = false) => {
    const d = v ? new Date(v) : null;
    if (!d || isNaN(d.getTime())) return typeof v === 'string' ? v : '';
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Belem',
      ...(withDate ? { day: '2-digit' as const, month: '2-digit' as const } : {}),
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d);
  };

  const safeMatches = (matches || []).filter((m: any) => !isWorldCupLeague(m.league)).map((m: any) => ({
    ...m,
    homeTeam: localizeTeamName(m.teams?.home?.name || m.homeTeam) || 'Casa',
    awayTeam: localizeTeamName(m.teams?.away?.name || m.awayTeam) || 'Fora',
    homeLogo: m.teams?.home?.logo,
    awayLogo: m.teams?.away?.logo,
    league: m.league?.name || m.league || '',
    time: fmt(m.fixture?.date || m.time),
  }))
  // Ligas de elite primeiro: garantem histórico real dentro do limite de enriquecimento
  .sort((a: any, b: any) => (isPremiumLeague(a.league) ? 0 : 1) - (isPremiumLeague(b.league) ? 0 : 1));

  // Enriquece com o histórico real (últimos jogos) — sem isso nenhum jogo passa nos critérios
  const { matches: eliteReady, isEnriching } = useScannerEnrichment(safeMatches as any);

  return (
    <div className="min-h-screen text-white pb-8 font-sans relative">
      <div
        className="fixed inset-0 z-0"
        style={{ backgroundImage: `url(${bgPattern})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
      />
      <div className="fixed inset-0 z-0 bg-black/50" />

      <main className="container max-w-3xl lg:max-w-6xl xl:max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 pt-4">
        <div className="flex items-center gap-3 mb-4">
          <Link to="/" className="p-2 bg-black/30 rounded-lg hover:bg-black/50">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <Crown className="w-6 h-6 text-amber-400" />
          <h1 className="text-xl font-black uppercase tracking-wider">Elite Performance</h1>
        </div>

        {isLoading || isEnriching ? (
          <p className="text-center text-muted-foreground py-8">Carregando histórico real das equipes...</p>
        ) : (
          <ElitePanel matches={eliteReady as any} />
        )}
      </main>
    </div>
  );
};

export default Elite;
