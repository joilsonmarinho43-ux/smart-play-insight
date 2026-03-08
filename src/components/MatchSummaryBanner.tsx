import { MatchData } from '@/types/match';
import { analyzeMarkets } from '@/lib/matchAnalysis';
import { useMemo } from 'react';
import { TrendingUp, Zap, Trophy, BarChart3 } from 'lucide-react';

interface Props {
  matches: MatchData[];
}

const STRONG_THRESHOLD = 75;

interface SignalSummary {
  label: string;
  count: number;
  total: number;
  icon: typeof TrendingUp;
}

const MatchSummaryBanner = ({ matches }: Props) => {
  const summaries = useMemo<SignalSummary[]>(() => {
    let over15 = 0;
    let over25 = 0;
    let over75corners = 0;
    let chanceDupla = 0;

    for (const match of matches) {
      const markets = analyzeMarkets(match);

      const o15 = markets.find(m => m.market === 'Over 1.5 Gols');
      if (o15 && o15.probability >= STRONG_THRESHOLD) over15++;

      const o25 = markets.find(m => m.market === 'Over 2.5 Gols');
      if (o25 && o25.probability >= STRONG_THRESHOLD) over25++;

      const o75 = markets.find(m => m.market === 'Over 7.5 Escanteios');
      if (o75 && o75.probability >= STRONG_THRESHOLD) over75corners++;

      const cd = markets.filter(m => m.market.startsWith('1X') || m.market.startsWith('X2'));
      if (cd.some(m => m.probability >= STRONG_THRESHOLD)) chanceDupla++;
    }

    return [
      { label: 'Over 1.5 Gols', count: over15, total: matches.length, icon: TrendingUp },
      { label: 'Over 2.5 Gols', count: over25, total: matches.length, icon: TrendingUp },
      { label: 'Over 7.5 Escanteios', count: over75corners, total: matches.length, icon: Zap },
      { label: 'Chance Dupla', count: chanceDupla, total: matches.length, icon: Trophy },
    ];
  }, [matches]);

  if (matches.length === 0) return null;

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 animate-fade-in">
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-bold text-foreground uppercase tracking-wide">
          Resumo de Sinais Fortes
        </h3>
        <span className="text-[10px] text-muted-foreground ml-auto">≥{STRONG_THRESHOLD}% prob.</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {summaries.map((s) => {
          const Icon = s.icon;
          const hasSignals = s.count > 0;
          return (
            <div
              key={s.label}
              className={`rounded-lg border p-3 text-center transition-colors ${
                hasSignals
                  ? 'border-primary/30 bg-primary/10'
                  : 'border-border bg-secondary/30'
              }`}
            >
              <Icon className={`w-4 h-4 mx-auto mb-1.5 ${hasSignals ? 'text-primary' : 'text-muted-foreground'}`} />
              <div className={`font-display text-2xl leading-none ${hasSignals ? 'text-primary' : 'text-muted-foreground'}`}>
                {s.count}
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">
                de {s.total}
              </div>
              <div className={`text-[10px] font-medium mt-0.5 ${hasSignals ? 'text-foreground' : 'text-muted-foreground'}`}>
                {s.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MatchSummaryBanner;
