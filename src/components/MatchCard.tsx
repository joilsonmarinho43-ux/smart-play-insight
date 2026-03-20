import { MatchData } from '@/types/match';
import MetricRow from './MetricRow';
import TicketSuggestionCard from './TicketSuggestion';
import { Clock, Trophy, Database, AlertTriangle } from 'lucide-react';

interface Props {
  match: MatchData;
}

const metricLabels: { key: keyof MatchData['metrics']; label: string; format: 'decimal' | 'integer' | 'percent' }[] = [
  { key: 'possession', label: 'Posse de Bola', format: 'percent' },
  { key: 'xG', label: 'Gols Esperados (xG)', format: 'decimal' },
  { key: 'totalShots', label: 'Finalizações Totais', format: 'integer' },
  { key: 'shotsOnTarget', label: 'Chutes no Gol', format: 'integer' },
  { key: 'bigChances', label: 'Grandes Chances', format: 'integer' },
  { key: 'corners', label: 'Escanteios', format: 'decimal' },
  { key: 'offsides', label: 'Impedimentos', format: 'integer' },
  { key: 'fouls', label: 'Faltas Cometidas', format: 'integer' },
  { key: 'yellowCards', label: 'Cartões Amarelos', format: 'decimal' },
];

// 🔥 COMPONENTE CORRIGIDO
function SampleSizeBadge({ match }: { match: MatchData }) {
  const s = match.sampleSize;

  if (!s) {
    return (
      <div className="px-3 py-1.5 rounded-lg border text-xs bg-red-500/10 text-red-400 border-red-500/20">
        Sem dados suficientes
      </div>
    );
  }

  // 🔥 USA TOTAL REAL (NÃO MAIS MIN)
  const homeGames = s.homeGames || 0;
  const awayGames = s.awayGames || 0;
  const totalGames = homeGames + awayGames;

  // 🔥 NÍVEL PROFISSIONAL
  const isHigh = totalGames >= 8;
  const isMedium = totalGames >= 4;

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
      <span className="font-medium">
        Confiança {label}
      </span>

      {/* DESKTOP */}
      <span className="opacity-70 hidden sm:inline">
        — {homeGames} jogos casa · {awayGames} jogos fora
      </span>

      {/* MOBILE */}
      <span className="opacity-70 sm:hidden">
        {homeGames}+{awayGames} jogos
      </span>
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

      {/* 🔥 AGORA FUNCIONA DE VERDADE */}
      <div className="px-4 sm:px-6 pt-3">
        <SampleSizeBadge match={match} />
      </div>

      {/* TIMES */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-6 px-4 sm:px-8 py-5 sm:py-6">
        <div className="text-right">
          <h2 className="font-display text-xl sm:text-3xl text-foreground leading-tight">
            {match.homeTeam}
          </h2>
          <span className="text-xs text-primary font-semibold">{match.predictions.homeWin}%</span>
        </div>

        <div className="flex flex-col items-center">
          <span className="font-display text-2xl sm:text-4xl text-muted-foreground">VS</span>
          <span className="text-[10px] text-muted-foreground mt-1">
            E {match.predictions.draw}%
          </span>
        </div>

        <div className="text-left">
          <h2 className="font-display text-xl sm:text-3xl text-foreground leading-tight">
            {match.awayTeam}
          </h2>
          <span className="text-xs text-accent font-semibold">{match.predictions.awayWin}%</span>
        </div>
      </div>

      {/* SUGESTÃO */}
      <div className="px-4 sm:px-6">
        <TicketSuggestionCard match={match} />
      </div>

      {/* MÉTRICAS */}
      <div className="px-2 sm:px-6 pb-5">
        <div className="space-y-0.5">
          {metricLabels.map((m, i) => {
            const values = match.metrics?.[m.key];
            if (!values || !Array.isArray(values)) return null;
            return (
              <MetricRow
                key={m.key}
                label={m.label}
                homeValue={values[0] ?? 0}
                awayValue={values[1] ?? 0}
                format={m.format}
                index={i}
              />
            );
          })}
        </div>
      </div>

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
