import { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { fetchLiveMatches } from '@/services/footballApi';
import LiveFieldAnimation from '@/components/LiveFieldAnimation';

const MatchDetails = () => {
  const { id } = useParams<{ id: string }>();

  const { data: matches, isLoading } = useQuery({
    queryKey: ['liveMatches'],
    queryFn: fetchLiveMatches,
    refetchInterval: 60_000,
  });

  const match = useMemo(
    () => matches?.find((m) => m.id === id),
    [matches, id],
  );

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 max-w-3xl mx-auto">
      <Link
        to="/live"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary mb-4 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Voltar para Live
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

      {match && (
        <div className="space-y-4">
          <LiveFieldAnimation
            homeTeam={match.homeTeam}
            awayTeam={match.awayTeam}
            homeScore={match.liveScore?.home ?? 0}
            awayScore={match.liveScore?.away ?? 0}
            minute={match.minute ?? 0}
            status={match.status ?? 'LIVE'}
            stats={{
              shotsOnGoalHome: match.metrics?.shotsOnTarget?.[0],
              shotsOnGoalAway: match.metrics?.shotsOnTarget?.[1],
              cornersHome: match.liveStats?.corners?.[0],
              cornersAway: match.liveStats?.corners?.[1],
              dangerousAttacksHome: match.liveStats?.dangerousAttacks?.[0],
              dangerousAttacksAway: match.liveStats?.dangerousAttacks?.[1],
            }}
          />

          {/* Stats rápidas */}
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

          <div className="text-center text-xs text-muted-foreground py-2">
            🏆 {match.league}
          </div>
        </div>
      )}
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
