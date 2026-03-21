import { useState } from 'react';
import { MatchData } from '@/types/match';
import TicketSuggestionCard from './TicketSuggestion';
import { Clock, Trophy, BarChart3, TrendingUp, Target, Database, AlertTriangle, Flame, Crosshair } from 'lucide-react';

interface Props {
  match: MatchData;
}

type TabKey = 'stats' | 'poisson' | 'ticket';

// ─── Pill-style stat row (exactly like the screenshot) ───
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
      <div className="w-[72px] flex justify-start">
        <span
          className={`inline-flex items-center justify-center min-w-[52px] px-3.5 py-2 rounded-full text-sm font-bold tabular-nums ${
            homeWins
              ? 'bg-[hsl(170,55%,42%)] text-white shadow-[0_2px_8px_hsl(170,55%,42%,0.35)]'
              : 'text-foreground'
          }`}
        >
          {fmt(home)}
        </span>
      </div>
      <span className="text-[13px] text-muted-foreground font-medium text-center flex-1 px-2">
        {label}
      </span>
      <div className="w-[72px] flex justify-end">
        <span
          className={`inline-flex items-center justify-center min-w-[52px] px-3.5 py-2 rounded-full text-sm font-bold tabular-nums ${
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

// ─── Confidence Badge ───
function SampleSizeBadge({ match }: { match: MatchData }) {
  const s = match.sampleSize;
  if (!s) {
    return (
      <div className="px-3 py-1.5 rounded-lg border text-xs bg-destructive/10 text-destructive border-destructive/20">
        Sem dados suficientes
      </div>
    );
  }

  const totalGames = (s.homeGames || 0) + (s.awayGames || 0);
  const isHigh = totalGames >= 6;
  const isMedium = totalGames >= 3;

  const color = isHigh
    ? 'bg-green-500/15 text-green-400 border-green-500/30'
    : isMedium
    ? 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30'
    : 'bg-destructive/15 text-destructive border-destructive/30';

  const Icon = isHigh || isMedium ? Database : AlertTriangle;
  const label = isHigh ? 'Alta' : isMedium ? 'Média' : 'Baixa';

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[10px] sm:text-xs ${color}`}>
      <Icon className="w-3 h-3 shrink-0" />
      <span className="font-medium">Confiança {label}</span>
      <span className="opacity-70">{s.homeGames}+{s.awayGames} jogos</span>
    </div>
  );
}

// ─── APM + xG Indicator ───
function ApmXgIndicator({ match }: { match: MatchData }) {
  const hs = (match as any).homeStats || {};
  const as_ = (match as any).awayStats || {};

  // APM calculation (same logic as matchAnalysis)
  const hDA = hs.dangerousAttacks || 0;
  const aDA = as_.dangerousAttacks || 0;
  const hShots = hs.totalShots || 0;
  const aShots = as_.totalShots || 0;
  const hSoG = hs.shotsOnGoal || 0;
  const aSoG = as_.shotsOnGoal || 0;

  let apm: number;
  if (hDA > 0 || aDA > 0) {
    apm = (hDA + aDA) / 90;
  } else {
    apm = ((hShots + aShots) * 1.5 + (hSoG + aSoG) * 2) / 90;
  }

  // xG (bigChances or estimated)
  const hXG = hs.bigChances || hs.expectedGoals || 0;
  const aXG = as_.bigChances || as_.expectedGoals || 0;
  let totalXG = hXG + aXG;
  if (totalXG === 0 && (hSoG > 0 || aSoG > 0)) {
    totalXG = (hSoG + aSoG) * 0.32;
  }

  const hasData = hShots > 0 || aShots > 0 || hSoG > 0 || aSoG > 0;
  if (!hasData) return null;

  const apmOk = apm >= 0.8;
  const apmColor = apmOk
    ? 'text-green-400 bg-green-500/10 border-green-500/20'
    : 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20';
  const xgColor = totalXG >= 2
    ? 'text-green-400 bg-green-500/10 border-green-500/20'
    : totalXG >= 1
    ? 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20'
    : 'text-gray-400 bg-gray-500/10 border-gray-500/20';

  return (
    <div className="flex items-center gap-2 mt-2">
      <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-bold ${apmColor}`}>
        <Flame className="w-3 h-3" />
        <span>APM {apm.toFixed(2)}</span>
        {apmOk && <span className="text-[8px] opacity-70">✓</span>}
      </div>
      <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-bold ${xgColor}`}>
        <Crosshair className="w-3 h-3" />
        <span>xG {totalXG.toFixed(2)}</span>
      </div>
    </div>
  );

// ─── Poisson helper ───
function poissonProb(lambda: number, k: number): number {
  let f = 1;
  for (let i = 2; i <= k; i++) f *= i;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / f;
}

// ─── TAB: Estatísticas (pill format like screenshot) ───
function StatsTab({ match }: { match: MatchData }) {
  const md = match.modelData as any;
  const hGF = md?.homeGoalsAvg || 0;
  const aGF = md?.awayGoalsAvg || 0;
  const hGA = md?.homeGoalsAgainstAvg || 0;
  const aGA = md?.awayGoalsAgainstAvg || 0;

  const hs = (match as any).homeStats || {};
  const as_ = (match as any).awayStats || {};

  const stats = [
    { label: 'Gols', home: hGF, away: aGF, format: 'decimal' as const },
    { label: 'Posse de Bola', home: hs.possession || 0, away: as_.possession || 0, format: 'percent' as const },
    { label: 'Finalizações Totais', home: hs.totalShots || 0, away: as_.totalShots || 0, format: 'decimal' as const },
    { label: 'Chutes no Gol', home: hs.shotsOnGoal || 0, away: as_.shotsOnGoal || 0, format: 'decimal' as const },
    { label: 'Grandes Chances', home: hs.bigChances || 0, away: as_.bigChances || 0, format: 'decimal' as const },
    { label: 'Escanteios', home: hs.corners || 0, away: as_.corners || 0, format: 'decimal' as const },
    { label: 'Impedimentos', home: hs.offsides || 0, away: as_.offsides || 0, format: 'decimal' as const },
    { label: 'Faltas Cometidas', home: hs.fouls || 0, away: as_.fouls || 0, format: 'decimal' as const },
    { label: 'Cartões Amarelos', home: hs.yellowCards || 0, away: as_.yellowCards || 0, format: 'decimal' as const },
  ].filter(s => s.home > 0 || s.away > 0);

  if (stats.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground text-sm">
        Estatísticas não disponíveis
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between px-2 pb-1 mb-1 border-b border-border/30">
        <span className="text-[10px] font-bold text-[hsl(170,55%,42%)] uppercase tracking-wider">{match.homeTeam}</span>
        <span className="text-[9px] text-muted-foreground/60 uppercase tracking-wider">Média 5 jogos</span>
        <span className="text-[10px] font-bold text-primary uppercase tracking-wider">{match.awayTeam}</span>
      </div>
      <div className="divide-y divide-border/20">
        {stats.map((s) => (
          <StatRow key={s.label} {...s} />
        ))}
      </div>
    </div>
  );
}

// ─── TAB: Poisson ───
function PoissonTab({ match }: { match: MatchData }) {
  const md = match.modelData as any;
  const hGF = md?.homeGoalsAvg || 0;
  const aGF = md?.awayGoalsAvg || 0;
  const hGA = md?.homeGoalsAgainstAvg || 0;
  const aGA = md?.awayGoalsAgainstAvg || 0;

  if (!hGF && !aGF) {
    return <div className="text-center py-6 text-muted-foreground text-sm">Dados insuficientes para Poisson</div>;
  }

  const leagueAvg = 1.35;
  const homeLambda = hGF > 0 && aGA > 0
    ? (hGF / leagueAvg) * (aGA / leagueAvg) * leagueAvg
    : hGF || 1.2;
  const awayLambda = aGF > 0 && hGA > 0
    ? (aGF / leagueAvg) * (hGA / leagueAvg) * leagueAvg
    : aGF || 0.9;

  const homeAttack = hGF / leagueAvg;
  const awayAttack = aGF / leagueAvg;
  const homeDefense = hGA / leagueAvg;
  const awayDefense = aGA / leagueAvg;

  const scores: { score: string; prob: number }[] = [];
  for (let h = 0; h <= 5; h++) {
    for (let a = 0; a <= 5; a++) {
      scores.push({ score: `${h}-${a}`, prob: poissonProb(homeLambda, h) * poissonProb(awayLambda, a) });
    }
  }
  scores.sort((a, b) => b.prob - a.prob);
  const topScores = scores.slice(0, 5);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-secondary/30 rounded-lg p-3 border border-border/30">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1">Mandante</p>
          <div className="flex justify-between text-xs">
            <span className="text-[hsl(170,55%,42%)]">⚔️ Ataque</span>
            <span className="font-bold tabular-nums">{homeAttack.toFixed(2)}x</span>
          </div>
          <div className="flex justify-between text-xs mt-1">
            <span className="text-destructive">🛡️ Defesa</span>
            <span className="font-bold tabular-nums">{homeDefense.toFixed(2)}x</span>
          </div>
          <div className="flex justify-between text-xs mt-2 pt-2 border-t border-border/30">
            <span className="text-muted-foreground">λ Poisson</span>
            <span className="font-bold text-[hsl(170,55%,42%)] tabular-nums">{homeLambda.toFixed(2)}</span>
          </div>
        </div>
        <div className="bg-secondary/30 rounded-lg p-3 border border-border/30">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1">Visitante</p>
          <div className="flex justify-between text-xs">
            <span className="text-primary">⚔️ Ataque</span>
            <span className="font-bold tabular-nums">{awayAttack.toFixed(2)}x</span>
          </div>
          <div className="flex justify-between text-xs mt-1">
            <span className="text-destructive">🛡️ Defesa</span>
            <span className="font-bold tabular-nums">{awayDefense.toFixed(2)}x</span>
          </div>
          <div className="flex justify-between text-xs mt-2 pt-2 border-t border-border/30">
            <span className="text-muted-foreground">λ Poisson</span>
            <span className="font-bold text-primary tabular-nums">{awayLambda.toFixed(2)}</span>
          </div>
        </div>
      </div>

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
          <h2 className="font-display text-xl sm:text-3xl text-foreground leading-tight">{match.homeTeam}</h2>
          <span className="text-xs text-[hsl(170,55%,42%)] font-semibold">{match.predictions?.homeWin}%</span>
        </div>
        <div className="flex flex-col items-center">
          <span className="font-display text-2xl sm:text-4xl text-muted-foreground">VS</span>
          <span className="text-[10px] text-muted-foreground mt-1">E {match.predictions?.draw}%</span>
        </div>
        <div className="text-left">
          <h2 className="font-display text-xl sm:text-3xl text-foreground leading-tight">{match.awayTeam}</h2>
          <span className="text-xs text-primary font-semibold">{match.predictions?.awayWin}%</span>
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
