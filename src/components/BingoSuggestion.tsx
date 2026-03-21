import { useMemo, useState } from 'react';
import { MatchData } from '@/types/match';
import { generatePreGameBingo, formatBingoWhatsApp } from '@/lib/bingoEngine';
import { Trophy, Copy, ChevronDown, ChevronUp, MessageCircle, Star } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  matches: MatchData[];
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

  const handleCopy = () => {
    const text = formatBingoWhatsApp(bingoData);
    navigator.clipboard.writeText(text);
    toast.success('Bingo copiado!');
  };

  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(formatBingoWhatsApp(bingoData))}`;

  return (
    <div className="bg-[#1e293b] rounded-2xl border border-orange-500/30 overflow-hidden">
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
            <h2 className="text-base font-bold text-orange-400 tracking-tight">BINGO REAL PRO</h2>
            <p className="text-[10px] text-gray-400 uppercase font-semibold">Confiança ≥ 78% • {bingoData.length} Jogos</p>
          </div>
        </div>
        {expanded ? <ChevronUp className="text-orange-500" /> : <ChevronDown className="text-orange-500" />}
      </button>

      {expanded && (
        <div className="p-4 space-y-3 border-t border-white/5">
          {bingoData.map((bm, idx) => (
            <div key={idx} className="bg-[#111827] border border-white/5 rounded-xl p-3">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h3 className="text-sm font-bold leading-tight">
                    {bm.homeTeam} <span className="text-orange-500/50 text-xs">vs</span> {bm.awayTeam}
                  </h3>
                  <p className="text-[10px] text-gray-500 mt-0.5">{bm.league} • {bm.time}</p>
                </div>
                <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
              </div>
              <div className="space-y-1.5">
                {bm.selectedMarkets.map((m: any, i: number) => {
                  const emoji = m.probability >= 90 ? '🟢🔥' : m.probability >= 85 ? '🟢' : '🟡';
                  return (
                    <div key={i} className="flex justify-between items-center bg-orange-500/5 px-2 py-1.5 rounded-lg border border-orange-500/10">
                      <span className="text-xs font-medium">{emoji} {m.market}</span>
                      <span className="text-xs font-bold text-orange-400">{m.probability}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="px-4 py-3 bg-[#111827] flex items-center justify-between border-t border-white/5">
        <span className="text-[10px] text-gray-500 italic">Poisson + xG • APM ≥ 0.8</span>
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
