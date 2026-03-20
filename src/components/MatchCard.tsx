import { MatchData } from '@/types/match';
import TicketSuggestionCard from './TicketSuggestion';
import { Clock, Trophy, Database, AlertTriangle, TrendingUp, BarChart3, Target, Shield } from 'lucide-react';

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

// Barra comparativa com valores
function StatBar({ label, home, away, icon: Icon, suffix = '' }: {
  label: string;
  home: number;
  away: number;
  icon: typeof TrendingUp;
  suffix?: string;
}) {
  const max = Math.max(home, away, 0.01);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px] px-1">
        <span className="font-bold tabular-nums text-primary">{home.toFixed(2)}{suffix}</span>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Icon className="w-3 h-3" />
          <span className="text-[9px] uppercase tracking-wider font-medium">{label}</span>
        </div>
        <span className="font-bold tabular-nums text-accent">{away.toFixed(2)}{suffix}</span>
      </div>
      <div className="flex gap-1 h-2.5">
        <div className="flex-1 bg-muted/20 rounded-full overflow-hidden flex justify-end">
          <div
            className="bg-primary/80 rounded-full transition-all duration-700"
            style={{ width: `${(home / max) * 100}%` }}
          />
        </div>
        <div className="flex-1 bg-muted/20 rounded-full overflow-hidden">
          <div
            className="bg-accent/80 rounded-full transition-all duration-700"
            style={{ width: `${(away / max) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// Poisson probability helper
function poissonProb(lambda: number, k: number): number {
  let f = 1;
  for (let i = 2; i <= k; i++) f *= i;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / f;
}

function RealStatsDisplay({ match }: { match: MatchData }) {
  const md = match.modelData;
  if (!md || (!md.homeGoalsAvg && !md.awayGoalsAvg)) return null;

  const hGF = md.homeGoalsAvg || 0;
  const aGF = md.awayGoalsAvg || 0;
  const hGA = (md as any).homeGoalsAgainstAvg || 0;
  const aGA = (md as any).awayGoalsAgainstAvg || 0;

  // Poisson lambdas reais
  const leagueAvg = 1.35;
  const homeLambda = hGF > 0 && aGA > 0
    ? (hGF / leagueAvg) * (aGA / leagueAvg) * leagueAvg
    : hGF || 1.2;
  const awayLambda = aGF > 0 && hGA > 0
    ? (aGF / leagueAvg) * (hGA / leagueAvg) * leagueAvg
    : aGF || 0.9;

  // Força de ataque e defesa (índice relativo à média da liga)
  const homeAttack = hGF / leagueAvg;
  const awayAttack = aGF / leagueAvg;
  const homeDefense = hGA / leagueAvg;
  const awayDefense = aGA / leagueAvg;

  // Top 5 placares mais prováveis
  const scores: { score: string; prob: number }[] = [];
  for (let h = 0; h <= 5; h++) {
    for (let a = 0; a <= 5; a++) {
      const p = poissonProb(homeLambda, h) * poissonProb(awayLambda, a);
      scores.push({ score: `${h}-${a}`, prob: p });
    }
  }
  scores.sort((a, b) => b.prob - a.prob);
  const topScores = scores.slice(0, 5);

  return (
    <div className="px-4 sm:px-6 pb-4 space-y-4">
      {/* Seção: Médias Reais */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="w-3.5 h-3.5 text-primary" />
          <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">
            Estatísticas Reais (Últimos 5 jogos)
          </span>
        </div>
        <div className="space-y-3">
          <StatBar label="Gols Marcados" home={hGF} away={aGF} icon={Target} />
          <StatBar label="Gols Sofridos" home={hGA} away={aGA} icon={Shield} />
        </div>
      </div>

      {/* Seção: Força Relativa */}
      <div className="border-t border-border/40 pt-3">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-3.5 h-3.5 text-primary" />
          <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">
            Índice de Força (vs Média da Liga)
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-secondary/30 rounded-lg p-3 border border-border/30">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1">Mandante</p>
            <div className="flex justify-between text-xs">
              <span className="text-primary">⚔️ Ataque</span>
              <span className="font-bold tabular-nums">{homeAttack.toFixed(2)}x</span>
            </div>
            <div className="flex justify-between text-xs mt-1">
              <span className="text-red-400">🛡️ Defesa</span>
              <span className="font-bold tabular-nums">{homeDefense.toFixed(2)}x</span>
            </div>
            <div className="flex justify-between text-xs mt-2 pt-2 border-t border-border/30">
              <span className="text-muted-foreground">λ Poisson</span>
              <span className="font-bold text-primary tabular-nums">{homeLambda.toFixed(2)}</span>
            </div>
          </div>
          <div className="bg-secondary/30 rounded-lg p-3 border border-border/30">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1">Visitante</p>
            <div className="flex justify-between text-xs">
              <span className="text-accent">⚔️ Ataque</span>
              <span className="font-bold tabular-nums">{awayAttack.toFixed(2)}x</span>
            </div>
            <div className="flex justify-between text-xs mt-1">
              <span className="text-red-400">🛡️ Defesa</span>
              <span className="font-bold tabular-nums">{awayDefense.toFixed(2)}x</span>
            </div>
            <div className="flex justify-between text-xs mt-2 pt-2 border-t border-border/30">
              <span className="text-muted-foreground">λ Poisson</span>
              <span className="font-bold text-accent tabular-nums">{awayLambda.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Seção: Placares Mais Prováveis */}
      <div className="border-t border-border/40 pt-3">
        <div className="flex items-center gap-2 mb-3">
          <Trophy className="w-3.5 h-3.5 text-primary" />
          <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">
            Placares Mais Prováveis (Poisson)
          </span>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {topScores.map((s, i) => (
            <div
              key={s.score}
              className={`flex-shrink-0 rounded-lg border px-3 py-2 text-center ${
                i === 0
                  ? 'bg-primary/10 border-primary/30'
                  : 'bg-secondary/30 border-border/30'
              }`}
            >
              <p className={`font-bold text-lg tabular-nums ${i === 0 ? 'text-primary' : 'text-foreground'}`}>
                {s.score}
              </p>
              <p className="text-[9px] text-muted-foreground tabular-nums">
                {(s.prob * 100).toFixed(1)}%
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Rodapé transparência */}
      <div className="text-center pt-2 border-t border-border/30">
        <span className="text-[8px] text-muted-foreground/50 uppercase tracking-widest">
          Todos os dados derivados de médias reais · API-Sports · Modelo Poisson
        </span>
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
          <span className="text-[10px] text-muted-foreground mt-1">E {match.predictions?.draw}%</span>
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

      {/* ESTATÍSTICAS REAIS DETALHADAS */}
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
