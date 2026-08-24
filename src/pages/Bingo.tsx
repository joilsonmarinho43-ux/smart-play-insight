import { useQuery } from '@tanstack/react-query';
import { Loader2, Trophy } from 'lucide-react';
import { fetchMultiDayMatches } from '@/services/footballApi';
import { isWorldCupLeague } from '@/lib/worldCupLeagues';
import { localizeTeamName } from '@/lib/teamI18n';
import TopWinsSuggestion from '@/components/TopWinsSuggestion';
import { useScannerEnrichment } from '@/hooks/useScannerEnrichment';
import { isPremiumLeague } from '@/lib/premiumLeagues';

const Bingo = () => {
  const { data: matches = [], isLoading } = useQuery({
    queryKey: ['multi-day-matches-bingo'],
    queryFn: () => fetchMultiDayMatches(),
    staleTime: 1000 * 60 * 10,
  });

  const fmt = (v: any) => {
    const d = v ? new Date(v) : null;
    if (!d || isNaN(d.getTime())) return typeof v === 'string' ? v : '';
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Belem', day: '2-digit', month: '2-digit',
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
    kickoff: m.fixture?.date || (typeof m.time === 'string' && m.time.includes('T') ? m.time : undefined),
    time: fmt(m.fixture?.date || m.time),
  }))
  .sort((a: any, b: any) => (isPremiumLeague(a.league) ? 0 : 1) - (isPremiumLeague(b.league) ? 0 : 1));

  // Só enriquece o que pode virar entrada: liga com mercado nas casas + jogo que ainda não começou.
  // Sem esse recorte o orçamento de enriquecimento se perde em jogos descartados depois.
  const candidates = safeMatches.filter(
    (m: any) => isUpcomingMatch(m) && isBookmakerLeague(m.league),
  );

  // Sem histórico real (>= 4 jogos por equipe) o Bingo descarta tudo — enriquece antes
  const { matches: bingoReady, isEnriching } = useScannerEnrichment(candidates as any);


  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="container max-w-3xl lg:max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <header className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-orange-500/15 flex items-center justify-center border border-orange-500/30">
            <Trophy className="w-5 h-5 text-orange-400" />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight text-orange-400">BINGO VIP PRO</h1>
            <p className="text-[11px] text-gray-500 uppercase tracking-wider">
              Top 4 — Maior chance de vitória do dia
            </p>
          </div>
        </header>

        {isLoading || isEnriching ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
          </div>
        ) : matches.length === 0 ? (
          <div className="text-center py-20 text-gray-500 text-sm">
            Nenhum jogo elegível encontrado.
          </div>
        ) : (
          <>
            <TopWinsSuggestion matches={bingoReady as any} />
          </>
        )}
      </div>
    </div>
  );
};

export default Bingo;
