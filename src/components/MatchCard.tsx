import { MatchData } from '@/types/match';
import TicketSuggestionCard from './TicketSuggestion';
import { Clock, Trophy, Database, AlertTriangle, TrendingUp } from 'lucide-react';

interface Props {
  match: MatchData;
}

function SampleSizeBadge({ match }: { match: MatchData }) {
  const s = match.sampleSize;

  if (!s) {
    return (
      <div className="px-3 py-1.5 rounded-lg border text-xs bg-red-500/10 text-red-400 border-red-500/20">
        Sem dados suficientes
      </div>
    );
  }

  const homeGames = s.homeGames || 0;
  const awayGames = s.awayGames || 0;
  const totalGames = homeGames + awayGames;

  const isHigh = totalGames >= 6;
  const isMedium = totalGames >= 3;

  const color = isHigh
    ? 'bg-green-500/15 text-green-400 border-green-500/30'
    : isMedium
    ? 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30'
    : 'bg-red-500/15 text-red-400 border-red-500/30';

  const Icon = isHigh ? Database : isMedium ? Database : AlertTriangle;
  const label = isHigh ? 'Alta' : isMedium ? 'Média' : 'Baixa';

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[10px] sm:text-xs ${color}`}>
      <Icon className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
      <span className="font-medium">Confiança {label}</span>
      <span className="opacity-70 hidden sm:inline">— {homeGames} jogos casa · {awayGames} jogos fora</span>
      <span className="opacity-70 sm:hidden">{homeGames}+{awayGames} jogos</span>
    </div>
  );
}

function RealStatsDisplay({ match }: { match: MatchData }) {
  const md = match.modelData;
  if (!md || (!md.homeGoalsAvg && !md.awayGoalsAvg)) return null;

  const hGF = md.homeGoalsAvg || 0;
  const aGF = md.awayGoalsAvg || 0;
  const hGA = (md as any).homeGoalsAgainstAvg || 0;
  const aGA = (md as any).awayGoalsAgainstAvg || 0;

  const stats = [
    { label: 'Gols Marcados (Média)', home: hGF, away: aGF },
    { label: 'Gols Sofridos (Média)', home: hGA, away: aGA },
  ];

  return (
    <div className="px-4 sm:px-6 pb-4 space-y-2">
      <div className="flex items-center gap-2 mb-2">
        <TrendingUp className="w-3.5 h-3.5 text-primary" />
        <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">
          Médias Reais (Últimos 5 jogos)
        </span>
      </div>
      {stats.map((s) => {
        const max = Math.max(s.home, s.away) || 1;
        return (
          <div key={s.label} className="space-y-1">
            <div className="flex justify-between text-[10px] text-muted-foreground px-1">
              <span className="font-bold tabular-nums">{s.home.toFixed(2)}</span>
              <span className="text-[9px] uppercase tracking-wider">{s.label}</span>
              <span className="font-bold tabular-nums">{s.away.toFixed(2)}</span>
            </div>
            <div className="flex gap-1 h-2">
              <div className="flex-1 bg-muted/30 rounded-full overflow-hidden flex justify-end">
                <div
                  className="bg-primary rounded-full transition-all duration-500"
                  style={{ width: `${(s.home / max) * 100}%` }}
                />
              </div>
              <div className="flex-1 bg-muted/30 rounded-full overflow-hidden">
                <div
                  className="bg-accent rounded-full transition-all duration-500"
                  style={{ width: `${(s.away / max) * 100}%` }}
                />
              </div>
            </div>
          </div>
        );
      })}

      {/* Lambda Poisson (transparência do modelo) */}
      <div className="mt-3 pt-2 border-t border-border/50">
        <div className="flex justify-between text-[9px] text-muted-foreground/70 uppercase tracking-wider px-1">
          <span>λ Casa: {((hGF / 1.35) * (aGA / 1.35) * 1.35).toFixed(2)}</span>
          <span className="font-semibold">Modelo Poisson</span>
          <span>λ Fora: {((aGF / 1.35) * (hGA / 1.35) * 1.35).toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}

const MatchCard = ({ match }: Props) => {
  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden animate-slide-in">
      
      {/* HEADER */}
      <div className="bg-secondary/50 px-4 sm:px-6 py-3 flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Trophy className="w-4 h-4 text-primary" />
          <span className="text-xs sm:text-sm font-medium">{match.league}</span>
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Clock className="w-3.5 h-3.5" />
          <span className="text-xs sm:text-sm">{match.time}</span>
        </div>
      </div>

      {/* CONFIANÇA */}
      <div className="px-4 sm:px-6 pt-3">
        <SampleSizeBadge match={match} />
      </div>

      {/* TIMES */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-6 px-4 sm:px-8 py-5 sm:py-6">
        <div className="text-right">
          <h2 className="font-display text-xl sm:text-3xl text-foreground leading-tight">
            {match.homeTeam}
          </h2>
          <span className="text-xs text-primary font-semibold">{match.predictions?.homeWin}%</span>
        </div>

        <div className="flex flex-col items-center">
          <span className="font-display text-2xl sm:text-4xl text-muted-foreground">VS</span>
          <span className="text-[10px] text-muted-foreground mt-1">
            E {match.predictions?.draw}%
          </span>
        </div>

        <div className="text-left">
          <h2 className="font-display text-xl sm:text-3xl text-foreground leading-tight">
            {match.awayTeam}
          </h2>
          <span className="text-xs text-accent font-semibold">{match.predictions?.awayWin}%</span>
        </div>
      </div>

      {/* SUGESTÃO DE BILHETE */}
      <div className="px-4 sm:px-6">
        <TicketSuggestionCard match={match} />
      </div>

      {/* ESTATÍSTICAS REAIS */}
      <RealStatsDisplay match={match} />

      {/* LEGENDA */}
      <div className="px-4 sm:px-6 py-3 bg-secondary/30 border-t border-border flex items-center justify-center gap-6">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-primary" />
          <span className="text-xs text-muted-foreground">Mandante</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-accent" />
          <span className="text-xs text-muted-foreground">Visitante</span>
        </div>
      </div>
    </div>
  );
};

export default MatchCard;
