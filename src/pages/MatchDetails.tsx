import { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BookOpen, Loader2 } from 'lucide-react';
import { fetchLiveMatches, fetchMultiDayMatches } from '@/services/footballApi';
import { useMatchReading } from '@/hooks/useMatchReading';
import { MatchReadingModal } from '@/components/MatchReadingModal';
import { localizeTeamName } from '@/lib/teamI18n';


const MatchDetails = () => {
  const { id } = useParams<{ id: string }>();

  const { data: live, isLoading: loadingLive } = useQuery({
    queryKey: ['liveMatches'],
    queryFn: fetchLiveMatches,
    refetchInterval: 120_000,
    staleTime: 240_000,
    refetchOnWindowFocus: false,
  });

  const { data: multi, isLoading: loadingMulti } = useQuery({
    queryKey: ['multi-day-matches-detail'],
    queryFn: () => fetchMultiDayMatches(6),
    staleTime: 1000 * 60 * 10,
    refetchOnWindowFocus: false,
  });

  const isLoading = loadingLive || loadingMulti;

  const match: any = useMemo(() => {
    const sid = String(id || '');
    const findIn = (arr: any[] | undefined) =>
      arr?.find((m) => String(m?.id ?? m?.fixture?.id) === sid);
    return findIn(live) || findIn(multi);
  }, [live, multi, id]);

  // Normalização: pré-jogo vem com m.fixture / m.teams; live vem com flat fields
  const view = useMemo(() => {
    if (!match) return null;
    const homeTeam = localizeTeamName(match.homeTeam || match.teams?.home?.name) || 'Casa';
    const awayTeam = localizeTeamName(match.awayTeam || match.teams?.away?.name) || 'Fora';
    const league = match.league?.name || match.league || '';
    const isLive = !!(match.minute || match.liveScore || match.liveStats);
    const dateIso = match.fixture?.date || match.date || null;
    const kickoff = dateIso
      ? new Intl.DateTimeFormat('pt-BR', {
          timeZone: 'America/Belem',
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(new Date(dateIso))
      : null;
    return { homeTeam, awayTeam, league, isLive, kickoff };
  }, [match]);

  const [readingOpen, setReadingOpen] = useState(false);
  const normalizedMatch = useMemo(() => {
    if (!match || !view) return null;
    return {
      ...(match as any),
      id: String((match as any).id ?? id ?? ''),
      homeTeam: view.homeTeam,
      awayTeam: view.awayTeam,
      league: view.league,
    } as any;
  }, [match, view, id]);
  const { reading, loading: readingLoading, context: readingContext, analyst, analystLoading } = useMatchReading(
    (normalizedMatch || (match as any)) ?? ({ homeTeam: '', awayTeam: '', id: '' } as any),
    readingOpen && !!normalizedMatch,
  );


  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 max-w-3xl mx-auto">
      <Link
        to="/live"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary mb-4 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Voltar
      </Link>

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      )}

      {!isLoading && !match && (
        <div className="text-center py-20 text-muted-foreground">
          Jogo não encontrado ou já finalizado.
        </div>
      )}

      {match && view && (
        <div className="space-y-4">
          <div className="bg-secondary/40 border border-border rounded-xl p-4 text-center">
            <div className="text-xs text-muted-foreground mb-1">{view.league}</div>
            <div className="font-display text-lg">
              {view.isLive ? (
                <>
                  {view.homeTeam}{' '}
                  <span className="text-primary">
                    {match.liveScore?.home ?? 0} - {match.liveScore?.away ?? 0}
                  </span>{' '}
                  {view.awayTeam}
                </>
              ) : (
                <>
                  {view.homeTeam} <span className="text-muted-foreground">vs</span> {view.awayTeam}
                </>
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {view.isLive
                ? `${match.status ?? 'LIVE'} · ${match.minute ?? 0}'`
                : view.kickoff
                ? `Início: ${view.kickoff}`
                : 'Pré-jogo'}
            </div>
          </div>

          <button
            onClick={() => setReadingOpen(true)}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-primary to-primary/70 text-primary-foreground font-bold text-sm shadow-lg hover:opacity-95 transition-opacity"
          >
            <BookOpen className="w-4 h-4" />
            📖 Leitura do Jogo
          </button>



          {view.isLive && (
            <div className="grid grid-cols-2 gap-3">
              <StatBox
                label="Posse de bola"
                home={match.liveStats?.possession?.[0] ?? 0}
                away={match.liveStats?.possession?.[1] ?? 0}
                suffix="%"
              />
              <StatBox
                label="Escanteios"
                home={match.liveStats?.corners?.[0] ?? 0}
                away={match.liveStats?.corners?.[1] ?? 0}
              />
              <StatBox
                label="Ataques perigosos"
                home={match.liveStats?.dangerousAttacks?.[0] ?? 0}
                away={match.liveStats?.dangerousAttacks?.[1] ?? 0}
              />
              <StatBox
                label="Pressão (PI)"
                home={match.liveStats?.pressureIndex?.[0] ?? 0}
                away={match.liveStats?.pressureIndex?.[1] ?? 0}
              />
            </div>
          )}

          {!view.isLive && (
            <div className="bg-secondary/30 border border-border rounded-xl p-4 text-center text-sm text-muted-foreground">
              Confira a análise completa deste jogo no Bingo VIP PRO ou no Scanner PRO.
              <div className="mt-3 flex gap-2 justify-center">
                <Link to="/bingo" className="px-3 py-1.5 rounded-lg bg-primary/15 text-primary text-xs font-bold">
                  Abrir Bingo
                </Link>
                <Link to="/scanner" className="px-3 py-1.5 rounded-lg bg-primary/15 text-primary text-xs font-bold">
                  Abrir Scanner
                </Link>
              </div>
            </div>
          )}

          <div className="text-center text-xs text-muted-foreground py-2">
            🏆 {view.league}
          </div>
        </div>
      )}

      <MatchReadingModal
        open={readingOpen}
        onOpenChange={setReadingOpen}
        reading={reading}
        loading={readingLoading}
        homeTeam={view?.homeTeam || ''}
        awayTeam={view?.awayTeam || ''}
        context={readingContext}
        analyst={analyst}
        analystLoading={analystLoading}
      />

    </div>
  );
};

const StatBox = ({
  label,
  home,
  away,
  suffix = '',
}: {
  label: string;
  home: number;
  away: number;
  suffix?: string;
}) => (
  <div className="bg-secondary/40 border border-border rounded-xl p-3">
    <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-2 text-center">
      {label}
    </div>
    <div className="flex items-center justify-between font-display text-lg">
      <span className="text-primary">
        {home}
        {suffix}
      </span>
      <span className="text-muted-foreground text-xs">vs</span>
      <span className="text-primary">
        {away}
        {suffix}
      </span>
    </div>
  </div>
);

export default MatchDetails;
