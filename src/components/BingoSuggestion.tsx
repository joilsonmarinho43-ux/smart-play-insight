import { useMemo } from 'react';
import { MatchData, MarketAnalysis } from '@/types/match';
import { analyzeMarkets } from '@/lib/matchAnalysis';
import { Sparkles, Trophy, TrendingUp, Zap, AlertTriangle, Ticket } from 'lucide-react';

interface Props {
  matches: MatchData[];
}

interface BingoEntry {
  match: MatchData;
  market: MarketAnalysis;
}

const categoryIcons: Record<string, typeof TrendingUp> = {
  goals: TrendingUp,
  corners: Zap,
  cards: AlertTriangle,
  result: Trophy,
};

const BingoSuggestion = ({ matches }: Props) => {
  const bingoEntries = useMemo(() => {
    const entries: BingoEntry[] = [];

    for (const match of matches) {
      const markets = analyzeMarkets(match);
      // Pick the highest probability market with >= 70%
      const best = markets.find((m) => m.probability >= 70);
      if (best) {
        entries.push({ match, market: best });
      }
    }

    // Sort by probability descending, pick top 5-8
    return entries
      .sort((a, b) => b.market.probability - a.market.probability)
      .slice(0, 8);
  }, [matches]);

  if (bingoEntries.length < 2) return null;

  const combinedProb = bingoEntries.reduce((acc, e) => acc * (e.market.probability / 100), 1) * 100;

  return (
    <div className="bg-card rounded-2xl border border-primary/30 overflow-hidden mb-6 animate-slide-in">
      {/* Header */}
      <div className="bg-primary/10 px-4 sm:px-6 py-3 flex items-center justify-between border-b border-primary/20">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          <h2 className="font-display text-lg sm:text-xl text-primary tracking-wider">
            BINGO DO DIA
          </h2>
        </div>
        <span className="text-xs bg-primary/20 text-primary px-2.5 py-1 rounded-full font-semibold">
          {bingoEntries.length} seleções
        </span>
      </div>

      {/* Description */}
      <div className="px-4 sm:px-6 pt-3 pb-2">
        <p className="text-xs text-muted-foreground">
          Seleção automática dos mercados com maior probabilidade (≥70%) de cada jogo do dia.
        </p>
      </div>

      {/* Entries */}
      <div className="px-4 sm:px-6 pb-3 space-y-1.5">
        {bingoEntries.map((entry, i) => {
          const Icon = categoryIcons[entry.market.category] || Ticket;
          const probColor =
            entry.market.probability >= 80 ? 'text-green-400' :
            entry.market.probability >= 70 ? 'text-yellow-400' :
            'text-muted-foreground';

          return (
            <div
              key={i}
              className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-secondary/40 border border-border/50"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Icon className="w-3.5 h-3.5 text-primary shrink-0" />
                <div className="min-w-0">
                  <span className="text-xs font-bold text-foreground truncate block">
                    {entry.match.homeTeam} vs {entry.match.awayTeam}
                  </span>
                  <span className="text-[10px] text-muted-foreground truncate block">
                    {entry.market.market}
                  </span>
                </div>
              </div>
              <span className={`font-bold text-sm ${probColor} shrink-0`}>
                {entry.market.probability}%
              </span>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="bg-secondary/30 border-t border-border px-4 sm:px-6 py-2.5 flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
          Prob. combinada estimada
        </span>
        <span className="font-display text-sm text-primary font-bold">
          {combinedProb.toFixed(1)}%
        </span>
      </div>
    </div>
  );
};

export default BingoSuggestion;
