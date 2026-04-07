import { useMemo, useState } from 'react';
import { MatchData } from '@/types/match';
import { generatePreGameBingo, formatBingoWhatsApp, CATEGORY_META } from '@/lib/bingoEngine';
import { Trophy, Copy, ChevronDown, ChevronUp, MessageCircle, Star } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  matches: MatchData[];
}

const CATEGORY_COLORS: Record<string, string> = {
  goals: 'border-orange-500/20 bg-orange-500/5',
  btts: 'border-green-500/20 bg-green-500/5',
  corners: 'border-blue-500/20 bg-blue-500/5',
  cards: 'border-yellow-500/20 bg-yellow-500/5',
  result: 'border-purple-500/20 bg-purple-500/5',
  chance_dupla: 'border-cyan-500/20 bg-cyan-500/5',
  handicap: 'border-pink-500/20 bg-pink-500/5',
  htft: 'border-emerald-500/20 bg-emerald-500/5',
};

const PROB_COLORS: Record<string, string> = {
  high: 'text-green-400',
  medium: 'text-yellow-400',
  low: 'text-orange-400',
};

function getProbColor(prob: number): string {
  if (prob >= 85) return PROB_COLORS.high;
  if (prob >= 78) return PROB_COLORS.medium;
  return PROB_COLORS.low;
}

const BingoSuggestion = ({ matches }: Props) => {
  const [expanded, setExpanded] = useState(false);

  const bingoData = useMemo(() => {
    if (!matches || matches.length === 0) return [];

    return matches
      .map(match => {
        const result = generatePreGameBingo(match);
        if (!result || !result.markets.length) return null;
        return { ...match, selectedMarkets: result.markets };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .slice(0, 12);
  }, [matches]);

  if (bingoData.length === 0) return null;

  // Count total markets across all matches
  const totalMarkets = bingoData.reduce((acc, bm) => acc + bm.selectedMarkets.length, 0);

  const handleCopy = () => {
    const text = formatBingoWhatsApp(bingoData);
    navigator.clipboard.writeText(text);
    toast.success('Bingo VIP copiado!');
  };

  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(formatBingoWhatsApp(bingoData))}`;

  return (
    <div className="bg-card rounded-2xl border border-orange-500/30 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full bg-gradient-to-r from-orange-500/20 to-transparent px-4 py-4 flex items-center justify-between hover:from-orange-500/30 transition-all"
      >
        <div className="flex items-center gap-3">
          <div className="bg-orange-500 p-2 rounded-lg">
            <Trophy className="w-5 h-5 text-black" />
          </div>
          <div className="text-left">
            <h2 className="text-base font-bold text-orange-400 tracking-tight">BINGO VIP PRO</h2>
            <p className="text-[10px] text-muted-foreground uppercase font-semibold">
              {bingoData.length} Jogos • {totalMarkets} Mercados • 10 Estratégias
            </p>
          </div>
        </div>
        {expanded ? <ChevronUp className="text-orange-500" /> : <ChevronDown className="text-orange-500" />}
      </button>

      {/* Strategy Tags */}
      <div className="px-4 py-2 flex gap-1.5 flex-wrap border-t border-white/5">
        {Object.entries(CATEGORY_META).map(([key, meta]) => (
          <span key={key} className="text-[9px] px-2 py-0.5 rounded-full bg-white/5 text-muted-foreground font-medium">
            {meta.icon} {meta.label}
          </span>
        ))}
      </div>

      {expanded && (
        <div className="p-4 space-y-3 border-t border-white/5">
          {bingoData.map((bm, idx) => (
            <div key={idx} className="bg-background border border-white/5 rounded-xl p-3">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h3 className="text-sm font-bold leading-tight">
                    {bm.homeTeam} <span className="text-orange-500/50 text-xs">vs</span> {bm.awayTeam}
                  </h3>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{bm.league} • {bm.time}</p>
                </div>
                <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
              </div>
              <div className="space-y-1.5">
                {bm.selectedMarkets.map((m: any, i: number) => {
                  const catMeta = CATEGORY_META[m.category] || { icon: '📌', label: '' };
                  const catColor = CATEGORY_COLORS[m.category] || 'border-white/10 bg-white/5';
                  const probColor = getProbColor(m.probability);
                  const emoji = m.probability >= 90 ? '🔥' : m.probability >= 85 ? '✅' : '';

                  return (
                    <div key={i} className={`flex justify-between items-center px-2.5 py-2 rounded-lg border ${catColor}`}>
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{catMeta.icon}</span>
                        <div>
                          <span className="text-xs font-medium">{m.market}</span>
                          <span className="text-[9px] text-muted-foreground ml-1.5">• {m.risk}</span>
                        </div>
                      </div>
                      <span className={`text-xs font-bold ${probColor}`}>
                        {m.probability}% {emoji}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="px-4 py-3 bg-background flex items-center justify-between border-t border-white/5">
        <span className="text-[10px] text-muted-foreground italic">Poisson + xG • Matemática Real</span>
        <div className="flex gap-2">
          <button
            onClick={handleCopy}
            className="flex items-center gap-2 bg-white/5 border border-white/10 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-white/10 transition-all"
          >
            <Copy className="w-3 h-3" /> Copiar
          </button>
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-green-500 transition-all"
          >
            <MessageCircle className="w-4 h-4" /> WhatsApp
          </a>
        </div>
      </div>
    </div>
  );
};

export default BingoSuggestion;
