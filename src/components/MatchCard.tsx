import { useState } from 'react';
import { MatchData } from '@/types/match';
import TicketSuggestionCard from './TicketSuggestion';
import GoalSparkline from './GoalSparkline';
import { Clock, Trophy, BarChart3, TrendingUp, Target, Database, AlertTriangle, Flame, Crosshair, BookOpen } from 'lucide-react';
import { useMatchReading } from '@/hooks/useMatchReading';
import { MatchReadingModal } from './MatchReadingModal';



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
    <div className="flex items-center justify-between py-3.5 px-1">
      <div className="w-[76px] flex justify-start">
        <span
          className={`inline-flex items-center justify-center min-w-[54px] px-3.5 py-2 rounded-full text-sm font-black tabular-nums ${
            homeWins
              ? 'bg-[hsl(170,55%,38%)] text-white shadow-[0_2px_10px_hsl(170,55%,38%,0.45)]'
              : 'bg-muted/60 text-foreground'
          }`}
        >
          {fmt(home)}
        </span>
      </div>
      <span className="text-[13px] text-muted-foreground font-medium text-center flex-1 px-2">
        {label}
      </span>
      <div className="w-[76px] flex justify-end">
        <span
          className={`inline-flex items-center justify-center min-w-[54px] px-3.5 py-2 rounded-full text-sm font-black tabular-nums ${
            awayWins
              ? 'bg-primary text-primary-foreground shadow-[0_2px_10px_hsl(var(--primary)/0.45)]'
              : 'bg-muted/60 text-foreground'
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
    totalXG = (hSoG + aSoG) * 0.22;
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
}

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

  const homeGoals = hs.recentGoalsFor || [];
  const awayGoals = as_.recentGoalsFor || [];
  const hasSparkline = homeGoals.length >= 2 || awayGoals.length >= 2;

  return (
    <div>
      <div className="flex items-center justify-between px-2 pb-1 mb-1 border-b border-border/30">
        <span className="text-[10px] font-bold text-[hsl(170,55%,42%)] uppercase tracking-wider">{match.homeTeam}</span>
        <span className="text-[9px] text-muted-foreground/60 uppercase tracking-wider">Média 5 jogos</span>
        <span className="text-[10px] font-bold text-primary uppercase tracking-wider">{match.awayTeam}</span>
      </div>

      {/* Sparkline de tendência de gols */}
      {hasSparkline && (
        <div className="flex items-center justify-around py-3 mb-2 bg-secondary/20 rounded-xl border border-border/20">
          <GoalSparkline data={homeGoals} color="hsl(170, 55%, 42%)" label={match.homeTeam?.split(' ')[0] || 'Casa'} />
          <div className="flex flex-col items-center gap-0.5">
            <TrendingUp className="w-3.5 h-3.5 text-muted-foreground/50" />
            <span className="text-[8px] text-muted-foreground/50 uppercase">Tendência</span>
          </div>
          <GoalSparkline data={awayGoals} color="hsl(24, 95%, 53%)" label={match.awayTeam?.split(' ')[0] || 'Fora'} />
        </div>
      )}

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
  const md = match.modelData;
  const hGF = md?.homeGoalsAvg || 0;
  const aGF = md?.awayGoalsAvg || 0;
  const hGA = md?.homeGoalsAgainstAvg || 0;
  const aGA = md?.awayGoalsAgainstAvg || 0;

  if (!hGF && !aGF) {
    return <div className="text-center py-6 text-muted-foreground text-sm">Dados insuficientes para Poisson</div>;
  }

  const leagueAvg = (match as any).homeStats?.leagueAvg || (match as any).awayStats?.leagueAvg || 1.30;
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

      {/* Placares Mais Prováveis — Top 6 com heatmap */}
      {(() => {
        const top6 = scores.slice(0, 6);
        const maxProb = top6[0]?.prob || 1;

        // Aggregate markets
        const over25 = scores.reduce((s, x) => {
          const [h, a] = x.score.split('-').map(Number);
          return h + a > 2 ? s + x.prob : s;
        }, 0);
        const btts = scores.reduce((s, x) => {
          const [h, a] = x.score.split('-').map(Number);
          return h > 0 && a > 0 ? s + x.prob : s;
        }, 0);

        return (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Trophy className="w-3.5 h-3.5 text-primary" />
              <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">
                Placares Mais Prováveis
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {top6.map((s, i) => {
                const intensity = s.prob / maxProb;
                const isTop = i === 0;
                return (
                  <div
                    key={s.score}
                    className={`relative rounded-xl border text-center py-3 px-2 transition-all ${
                      isTop
                        ? 'bg-primary/15 border-primary/40 shadow-lg shadow-primary/10 ring-1 ring-primary/20'
                        : 'bg-secondary/30 border-border/30'
                    }`}
                  >
                    {isTop && (
                      <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-[7px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider">
                        Favorito
                      </span>
                    )}
                    <p className={`font-black text-xl tabular-nums ${isTop ? 'text-primary' : 'text-foreground'}`}>
                      {s.score}
                    </p>
                    {/* Probability bar */}
                    <div className="mt-1.5 mx-auto w-4/5 h-1 rounded-full bg-muted/40 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${isTop ? 'bg-primary' : 'bg-muted-foreground/50'}`}
                        style={{ width: `${intensity * 100}%` }}
                      />
                    </div>
                    <p className={`text-[10px] mt-1 tabular-nums font-bold ${isTop ? 'text-primary' : 'text-muted-foreground'}`}>
                      {(s.prob * 100).toFixed(1)}%
                    </p>
                  </div>
                );
              })}
            </div>

            {/* Market summary */}
            <div className="flex gap-2">
              <div className={`flex-1 rounded-lg border px-3 py-2 text-center ${over25 >= 0.5 ? 'bg-green-500/10 border-green-500/25' : 'bg-secondary/30 border-border/30'}`}>
                <p className="text-[8px] text-muted-foreground uppercase tracking-wider">Over 2.5</p>
                <p className={`text-sm font-black tabular-nums ${over25 >= 0.5 ? 'text-green-400' : 'text-foreground'}`}>{(over25 * 100).toFixed(1)}%</p>
              </div>
              <div className={`flex-1 rounded-lg border px-3 py-2 text-center ${btts >= 0.5 ? 'bg-green-500/10 border-green-500/25' : 'bg-secondary/30 border-border/30'}`}>
                <p className="text-[8px] text-muted-foreground uppercase tracking-wider">BTTS</p>
                <p className={`text-sm font-black tabular-nums ${btts >= 0.5 ? 'text-green-400' : 'text-foreground'}`}>{(btts * 100).toFixed(1)}%</p>
              </div>
              <div className="flex-1 rounded-lg border bg-secondary/30 border-border/30 px-3 py-2 text-center">
                <p className="text-[8px] text-muted-foreground uppercase tracking-wider">Total λ</p>
                <p className="text-sm font-black tabular-nums text-foreground">{(homeLambda + awayLambda).toFixed(2)}</p>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── MAIN COMPONENT ───
const MatchCard = ({ match }: Props) => {
  const [activeTab, setActiveTab] = useState<TabKey>('stats');
  const [readingOpen, setReadingOpen] = useState(false);
  const { reading, loading, context, analyst, analystLoading } = useMatchReading(match, readingOpen);


  const tabs: { key: TabKey; label: string; icon: typeof BarChart3 }[] = [
    { key: 'stats', label: 'Estatísticas', icon: BarChart3 },
    { key: 'poisson', label: 'Poisson', icon: TrendingUp },
    { key: 'ticket', label: 'Bilhete', icon: Target },
  ];


  return (
    <div className="bg-card rounded-2xl sm:rounded-3xl border border-border overflow-hidden animate-slide-in shadow-2xl shadow-black/20 flex flex-col h-full">
      {/* HEADER */}
      <div className="bg-secondary/50 px-4 sm:px-5 py-3 sm:py-3.5 flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-2 text-muted-foreground min-w-0">
          <Trophy className="w-4 h-4 text-primary shrink-0" />
          <span className="text-xs sm:text-sm font-medium truncate">{match.league}</span>
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground shrink-0">
          <Clock className="w-3.5 h-3.5" />
          <span className="text-xs sm:text-sm">{match.time}</span>
        </div>
      </div>

      {/* CONFIANÇA */}
      <div className="px-4 sm:px-5 pt-3 sm:pt-4">
        <SampleSizeBadge match={match} />
        <ApmXgIndicator match={match} />
      </div>

      {/* TIMES */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-5 px-4 sm:px-6 py-5 sm:py-6">
        <div className="text-right min-w-0">
          <h2 className="font-display text-xl sm:text-2xl lg:text-3xl text-foreground leading-tight font-black break-words">{match.homeTeam}</h2>
          <span className="text-sm text-[hsl(170,55%,42%)] font-bold mt-1 inline-block">{match.predictions?.homeWin}%</span>
        </div>
        <div className="flex flex-col items-center shrink-0">
          <span className="font-display text-2xl sm:text-3xl lg:text-4xl text-muted-foreground">VS</span>
          <span className="text-[11px] text-muted-foreground mt-1">E {match.predictions?.draw}%</span>
        </div>
        <div className="text-left min-w-0">
          <h2 className="font-display text-xl sm:text-2xl lg:text-3xl text-foreground leading-tight font-black break-words">{match.awayTeam}</h2>
          <span className="text-sm text-primary font-bold mt-1 inline-block">{match.predictions?.awayWin}%</span>
        </div>
      </div>

      {/* TAB BUTTONS */}
      <div className="px-4 sm:px-5 flex gap-2">
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
              <span className="hidden xs:inline sm:inline">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB CONTENT */}
      <div className="px-4 sm:px-5 py-4 sm:py-5 flex-1">
        {activeTab === 'stats' && <StatsTab match={match} />}
        {activeTab === 'poisson' && <PoissonTab match={match} />}
        {activeTab === 'ticket' && <TicketSuggestionCard match={match} />}
      </div>

      {/* LEITURA DO JOGO */}
      <div className="px-4 sm:px-5 pb-3">
        <button
          onClick={() => setReadingOpen(true)}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-primary to-primary/70 text-primary-foreground font-bold text-xs sm:text-sm shadow-lg hover:opacity-95 transition-opacity"
        >
          <BookOpen className="w-4 h-4" />
          📖 Leitura do Jogo
        </button>
      </div>

      {/* RODAPÉ */}
      <div className="text-center py-2 border-t border-border/30 mt-auto">
        <span className="text-[8px] text-muted-foreground/50 uppercase tracking-widest">
          Dados reais · API-Sports · Últimos 5 jogos
        </span>
      </div>

      <MatchReadingModal
        open={readingOpen}
        onOpenChange={setReadingOpen}
        reading={reading}
        loading={loading}
        homeTeam={match.homeTeam}
        awayTeam={match.awayTeam}
        context={context}
        analyst={analyst}
        analystLoading={analystLoading}
      />

    </div>
  );
};


export default MatchCard;
