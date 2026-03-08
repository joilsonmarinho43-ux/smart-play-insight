import { MatchData } from '@/types/match';
import { analyzeMarkets } from '@/lib/matchAnalysis';
import { useEffect, useMemo, useState } from 'react';
import { TrendingUp, Zap, Trophy, BarChart3 } from 'lucide-react';

interface Props {
  matches: MatchData[];
  onFilterChange?: (matchIds: string[] | null, label: string | null) => void;
}

const STRONG_THRESHOLD = 75;

type SignalKey = 'over15' | 'over25' | 'over75corners' | 'chanceDupla';

interface SignalSummary {
  key: SignalKey;
  label: string;
  count: number;
  total: number;
  icon: typeof TrendingUp;
  matchIds: Set<string>;
}

function getSignalData(matches: MatchData[]): SignalSummary[] {
  const over15Ids = new Set<string>();
  const over25Ids = new Set<string>();
  const over75Ids = new Set<string>();
  const cdIds = new Set<string>();

  for (const match of matches) {
    const markets = analyzeMarkets(match);
    const id = String(match.id);

    const o15 = markets.find((m) => m.market === 'Over 1.5 Gols');
    if (o15 && o15.probability >= STRONG_THRESHOLD) over15Ids.add(id);

    const o25 = markets.find((m) => m.market === 'Over 2.5 Gols');
    if (o25 && o25.probability >= STRONG_THRESHOLD) over25Ids.add(id);

    const o75 = markets.find((m) => m.market === 'Over 7.5 Escanteios');
    if (o75 && o75.probability >= STRONG_THRESHOLD) over75Ids.add(id);

    const cd = markets.filter((m) => m.market.startsWith('1X') || m.market.startsWith('X2'));
    if (cd.some((m) => m.probability >= STRONG_THRESHOLD)) cdIds.add(id);
  }

  return [
    { key: 'over15', label: 'Over 1.5 Gols', count: over15Ids.size, total: matches.length, icon: TrendingUp, matchIds: over15Ids },
    { key: 'over25', label: 'Over 2.5 Gols', count: over25Ids.size, total: matches.length, icon: TrendingUp, matchIds: over25Ids },
    { key: 'over75corners', label: 'Over 7.5 Escanteios', count: over75Ids.size, total: matches.length, icon: Zap, matchIds: over75Ids },
    { key: 'chanceDupla', label: 'Chance Dupla', count: cdIds.size, total: matches.length, icon: Trophy, matchIds: cdIds },
  ];
}

const MatchSummaryBanner = ({ matches, onFilterChange }: Props) => {
  const [activeSignal, setActiveSignal] = useState<SignalKey | null>(null);

  const summaries = useMemo(() => getSignalData(matches), [matches]);
  const activeData = useMemo(
    () => summaries.find((s) => s.key === activeSignal) ?? null,
    [summaries, activeSignal]
  );

  useEffect(() => {
    if (!onFilterChange) return;
    if (!activeData) {
      onFilterChange(null, null);
      return;
    }
    onFilterChange(Array.from(activeData.matchIds), activeData.label);
  }, [activeData, onFilterChange]);

  if (matches.length === 0) return null;

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 animate-fade-in">
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-bold text-foreground uppercase tracking-wide">Resumo de Sinais Fortes</h3>
        <span className="text-[10px] text-muted-foreground ml-auto">≥{STRONG_THRESHOLD}% prob.</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {summaries.map((s) => {
          const Icon = s.icon;
          const hasSignals = s.count > 0;
          const isActive = activeSignal === s.key;

          return (
            <button
              key={s.key}
              onClick={() => hasSignals && setActiveSignal(isActive ? null : s.key)}
              disabled={!hasSignals}
              className={`rounded-lg border p-3 text-center transition-all ${
                isActive
                  ? 'border-primary bg-primary/20 ring-2 ring-primary/30'
                  : hasSignals
                    ? 'border-primary/30 bg-primary/10 hover:bg-primary/15 cursor-pointer'
                    : 'border-border bg-secondary/30 cursor-default opacity-60'
              }`}
            >
              <Icon className={`w-4 h-4 mx-auto mb-1.5 ${isActive || hasSignals ? 'text-primary' : 'text-muted-foreground'}`} />
              <div className={`font-display text-2xl leading-none ${isActive || hasSignals ? 'text-primary' : 'text-muted-foreground'}`}>
                {s.count}
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">de {s.total}</div>
              <div className={`text-[10px] font-medium mt-0.5 ${isActive || hasSignals ? 'text-foreground' : 'text-muted-foreground'}`}>
                {s.label}
              </div>
            </button>
          );
        })}
      </div>

      {activeData && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 animate-fade-in">
          <span className="text-xs text-foreground">
            Filtro ativo: <span className="text-primary font-semibold">{activeData.label}</span> ({activeData.count} jogos)
          </span>
          <button
            onClick={() => setActiveSignal(null)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Limpar
          </button>
        </div>
      )}
    </div>
  );
};

export default MatchSummaryBanner;
