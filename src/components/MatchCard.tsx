import { useState } from 'react';
import { MatchData } from '@/types/match';
import TicketSuggestionCard from './TicketSuggestion';
import { Clock, Trophy, BarChart3, TrendingUp, Target, Shield, Database, AlertTriangle } from 'lucide-react';

interface Props {
  match: MatchData;
}

type TabKey = 'stats' | 'poisson' | 'ticket';

// ─── Pill-style stat row (like screenshot) ───
function StatRow({ label, home, away, format = 'decimal' }: {
  label: string;
  home: number;
  away: number;
  format?: 'decimal' | 'integer' | 'percent';
}) {
  const fmt = (v: number) => {
    if (format === 'percent') return `${v.toFixed(1)}%`;
    if (format === 'integer') return String(Math.round(v));
    return v.toFixed(1);
  };

  const homeWins = home > away;
  const awayWins = away > home;

  return (
    <div className="flex items-center justify-between py-3 px-1">
      {/* Home pill */}
      <div className="w-[72px] flex justify-start">
        <span
          className={`inline-flex items-center justify-center min-w-[52px] px-3.5 py-2 rounded-full text-sm font-bold tabular-nums transition-all ${
            homeWins
              ? 'bg-[hsl(170,55%,42%)] text-white shadow-[0_2px_8px_hsl(170,55%,42%,0.35)]'
              : 'text-foreground'
          }`}
        >
          {fmt(home)}
        </span>
      </div>

      {/* Label */}
      <span className="text-[13px] text-muted-foreground font-medium text-center flex-1 px-2">
        {label}
      </span>

      {/* Away pill */}
      <div className="w-[72px] flex justify-end">
        <span
          className={`inline-flex items-center justify-center min-w-[52px] px-3.5 py-2 rounded-full text-sm font-bold tabular-nums transition-all ${
            awayWins
              ? 'bg-primary text-primary-foreground shadow-[0_2px_8px_hsl(var(--primary)/0.35)]'
              : 'text-foreground'
          }`}
        >
          {fmt(away)}
        </span>
      </div>
    </div>
  );
}
  scores.sort((a, b) => b.prob - a.prob);
  const topScores = scores.slice(0, 5);

  return (
    <div className="space-y-4">
      {/* Força relativa */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-secondary/30 rounded-lg p-3 border border-border/30">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1">Mandante</p>
          <div className="flex justify-between text-xs">
            <span className="text-primary">⚔️ Ataque</span>
            <span className="font-bold tabular-nums">{homeAttack.toFixed(2)}x</span>
          </div>
          <div className="flex justify-between text-xs mt-1">
            <span className="text-destructive">🛡️ Defesa</span>
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
            <span className="text-destructive">🛡️ Defesa</span>
            <span className="font-bold tabular-nums">{awayDefense.toFixed(2)}x</span>
          </div>
          <div className="flex justify-between text-xs mt-2 pt-2 border-t border-border/30">
            <span className="text-muted-foreground">λ Poisson</span>
            <span className="font-bold text-accent tabular-nums">{awayLambda.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Top placares */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Trophy className="w-3.5 h-3.5 text-primary" />
          <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">
            Placares Mais Prováveis
          </span>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {topScores.map((s, i) => (
            <div
              key={s.score}
              className={`flex-shrink-0 rounded-lg border px-3 py-2 text-center ${
                i === 0 ? 'bg-primary/10 border-primary/30' : 'bg-secondary/30 border-border/30'
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
    </div>
  );
}

// ─── MAIN COMPONENT ───
const MatchCard = ({ match }: Props) => {
  const [activeTab, setActiveTab] = useState<TabKey>('stats');

  const tabs: { key: TabKey; label: string; icon: typeof BarChart3 }[] = [
    { key: 'stats', label: 'Estatísticas', icon: BarChart3 },
    { key: 'poisson', label: 'Poisson', icon: TrendingUp },
    { key: 'ticket', label: 'Bilhete', icon: Target },
  ];

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

      {/* TAB BUTTONS */}
      <div className="px-4 sm:px-6 flex gap-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
                isActive
                  ? 'bg-primary text-primary-foreground shadow-lg'
                  : 'bg-secondary/50 text-muted-foreground hover:bg-secondary'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* TAB CONTENT */}
      <div className="px-4 sm:px-6 py-4">
        {activeTab === 'stats' && <StatsTab match={match} />}
        {activeTab === 'poisson' && <PoissonTab match={match} />}
        {activeTab === 'ticket' && <TicketSuggestionCard match={match} />}
      </div>

      {/* RODAPÉ */}
      <div className="text-center py-2 border-t border-border/30">
        <span className="text-[8px] text-muted-foreground/50 uppercase tracking-widest">
          Dados reais · API-Sports · Últimos 5 jogos
        </span>
      </div>
    </div>
  );
};

export default MatchCard;
