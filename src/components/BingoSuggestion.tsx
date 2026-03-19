import { useMemo, useState } from 'react';
import { MatchData } from '@/types/match';
import { generatePreGameBingo } from '@/lib/bingoEngine';
import { Sparkles, Trophy, TrendingUp, Zap, AlertTriangle, Ticket, Clock, Copy, ChevronDown, ChevronUp, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  matches: MatchData[];
}

interface BingoMarket {
  market: string;
  probability: number;
  category: string;
}

interface BingoMatch {
  match: MatchData;
  markets: BingoMarket[];
}

const categoryIcons: Record<string, typeof TrendingUp> = {
  goals: TrendingUp,
  result: Trophy,
};

// 🔥 NOVO FILTRO REAL
function getBingoMarkets(match: MatchData): BingoMarket[] {
  const data = generatePreGameBingo(match);

  if (!data) return [];

  const markets: BingoMarket[] = [];

  const over15 = Number(data.over15);
  const over25 = Number(data.over25);
  const btts = Number(data.btts);

  if (over15 >= 70) {
    markets.push({
      market: 'Over 1.5 Gols',
      probability: over15,
      category: 'goals',
    });
  }

  if (over25 >= 60) {
    markets.push({
      market: 'Over 2.5 Gols',
      probability: over25,
      category: 'goals',
    });
  }

  if (btts >= 55) {
    markets.push({
      market: 'Ambas Marcam',
      probability: btts,
      category: 'goals',
    });
  }

  return markets;
}

function getBingoText(bingoMatches: BingoMatch[], totalSelections: number): string {
  const lines = ['🎯 *BINGO REAL — ANALISTA JOILSON*', ''];

  for (const bm of bingoMatches) {
    lines.push(`⚽ *${bm.match.homeTeam} vs ${bm.match.awayTeam}*`);
    lines.push(`🕐 ${bm.match.time} • ${bm.match.league}`);

    for (const m of bm.markets) {
      lines.push(`  📊 ${m.market} — *${m.probability}%*`);
    }

    lines.push('');
  }

  lines.push(`📈 ${bingoMatches.length} jogos • ${totalSelections} entradas`);
  lines.push('_Modelo Poisson real (sem manipulação)_');

  return lines.join('\n');
}

const BingoSuggestion = ({ matches }: Props) => {
  const bingoMatches = useMemo(() => {
    const results: BingoMatch[] = [];

    for (const match of matches) {
      const markets = getBingoMarkets(match);

      if (markets.length > 0) {
        results.push({ match, markets });
      }
    }

    return results
      .sort((a, b) => b.markets.length - a.markets.length)
      .slice(0, 15);
  }, [matches]);

  const [expanded, setExpanded] = useState(false);

  if (bingoMatches.length === 0) return null;

  const totalSelections = bingoMatches.reduce(
    (acc, bm) => acc + bm.markets.length,
    0
  );

  return (
    <div className="bg-card rounded-2xl border border-primary/30 overflow-hidden mb-6">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full bg-primary/10 px-4 py-3 flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          <h2 className="text-lg text-primary">BINGO REAL</h2>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs bg-primary/20 px-2 py-1 rounded">
            {bingoMatches.length} jogos • {totalSelections}
          </span>
          {expanded ? <ChevronUp /> : <ChevronDown />}
        </div>
      </button>

      {expanded && (
        <div className="p-4 space-y-3">
          {bingoMatches.map((bm, idx) => (
            <div key={idx} className="border rounded-lg">
              <div className="bg-secondary px-3 py-2 flex justify-between">
                <span>
                  {bm.match.homeTeam} vs {bm.match.awayTeam}
                </span>
                <span className="text-xs">
                  {bm.match.time}
                </span>
              </div>

              {bm.markets.map((m, i) => (
                <div key={i} className="flex justify-between px-3 py-2 border-t">
                  <span>{m.market}</span>
                  <span className="font-bold text-green-400">
                    {m.probability}%
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="p-3 flex justify-end gap-2">
        <button
          onClick={() => {
            const text = getBingoText(bingoMatches, totalSelections);
            navigator.clipboard.writeText(text);
            toast.success('Copiado!');
          }}
          className="text-xs bg-primary/20 px-3 py-1 rounded"
        >
          <Copy className="w-3 h-3 inline" /> Copiar
        </button>

        <a
          href={`https://wa.me/?text=${encodeURIComponent(
            getBingoText(bingoMatches, totalSelections)
          )}`}
          target="_blank"
        >
          <MessageCircle className="w-4 h-4" />
        </a>
      </div>
    </div>
  );
};

export default BingoSuggestion;
