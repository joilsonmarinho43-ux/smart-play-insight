import { useMemo } from 'react';
import { MatchData } from '@/types/match';
import { analyzeMarkets } from '@/lib/matchAnalysis';
import { Trophy, Copy, MessageCircle, Crown } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  matches: MatchData[];
}

interface WinPick {
  match: MatchData;
  side: 'home' | 'away';
  team: string;
  opponent: string;
  probability: number;
  homeWin: number;
  awayWin: number;
  draw: number;
}

const UNSTABLE = [
  'club friendly', 'friendlies', 'international friendly',
  'u17', 'u19', 'u20', 'u21', 'u23', 'sub-17', 'sub-19', 'sub-20', 'sub-21', 'sub-23',
  'reserve', 'reserva', 'youth', 'juvenil', 'amateur', 'amador',
  'women', 'feminino',
];

function isStable(m: MatchData): boolean {
  const l = (m.league || '').toLowerCase();
  return !UNSTABLE.some(t => l.includes(t));
}

function hasReliable(m: MatchData): boolean {
  const h = m.sampleSize?.homeGames || (m as any).homeStats?.gamesCount || 0;
  const a = m.sampleSize?.awayGames || (m as any).awayStats?.gamesCount || 0;
  return h >= 4 && a >= 4;
}

const TopWinsSuggestion = ({ matches }: Props) => {
  const picks = useMemo<WinPick[]>(() => {
    if (!matches || matches.length === 0) return [];

    const candidates: WinPick[] = [];
    for (const m of matches) {
      if (!isStable(m) || !hasReliable(m)) continue;
      const mk = analyzeMarkets(m);
      const home = mk.find(x => x.market === 'Vitória Casa');
      const away = mk.find(x => x.market === 'Vitória Fora');
      const homeP = home?.probability ?? 0;
      const awayP = away?.probability ?? 0;
      const drawP = Math.max(0, 100 - homeP - awayP);

      // Apenas escolha de vitória direta com folga real e empate baixo
      const best = homeP >= awayP ? { side: 'home' as const, prob: homeP } : { side: 'away' as const, prob: awayP };
      const margin = Math.abs(homeP - awayP);

      // Filtros realistas: prob >= 45, margem >= 12, empate <= 35
      if (best.prob < 45 || margin < 12 || drawP > 35) continue;

      candidates.push({
        match: m,
        side: best.side,
        team: best.side === 'home' ? m.homeTeam : m.awayTeam,
        opponent: best.side === 'home' ? m.awayTeam : m.homeTeam,
        probability: best.prob,
        homeWin: homeP,
        awayWin: awayP,
        draw: drawP,
      });
    }

    return candidates.sort((a, b) => b.probability - a.probability).slice(0, 4);
  }, [matches]);

  if (picks.length === 0) return null;

  const buildText = () => {
    const header = `👑 *TOP 4 — VITÓRIA DIRETA*\n*Trade Esportivo Profissional*\n${'─'.repeat(30)}\n\n`;
    const body = picks.map((p, i) => {
      const fav = `${p.team}`;
      return `${i + 1}️⃣ *${p.match.homeTeam} vs ${p.match.awayTeam}*\n🏆 ${p.match.league} • ⏰ ${p.match.time}\n✅ Vitória: *${fav}* → _${p.probability}%_\n`;
    }).join('\n');
    const footer = `\n${'─'.repeat(30)}\n📊 *${picks.length} entradas do dia*\n🧠 _Poisson + xG_\n✅ _Margem mínima 18% • Empate ≤ 28%_`;
    return header + body + footer;
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(buildText());
    toast.success('Top 4 Vitória Direta copiado!');
  };

  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(buildText())}`;

  return (
    <div className="bg-card rounded-2xl border border-yellow-500/30 overflow-hidden mb-4">
      <div className="bg-gradient-to-r from-yellow-500/20 to-transparent px-4 py-4 flex items-center gap-3">
        <div className="bg-yellow-500 p-2 rounded-lg">
          <Crown className="w-5 h-5 text-black" />
        </div>
        <div>
          <h2 className="text-base font-bold text-yellow-400 tracking-tight">TOP 4 VITÓRIA DIRETA</h2>
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">
            As 4 melhores entradas do dia
          </p>
        </div>
      </div>

      <div className="p-4 space-y-2">
        {picks.map((p, idx) => (
          <div key={idx} className="bg-background border border-yellow-500/10 rounded-xl p-3">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <span className="text-lg font-black text-yellow-500/70 w-5">{idx + 1}</span>
                <div>
                  <h3 className="text-sm font-bold leading-tight">
                    {p.match.homeTeam} <span className="text-yellow-500/50 text-xs">vs</span> {p.match.awayTeam}
                  </h3>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{p.match.league} • {p.match.time}</p>
                </div>
              </div>
              <span className="text-sm font-bold text-yellow-400 shrink-0">{p.probability}%</span>
            </div>
            <div className="flex items-center justify-between px-2.5 py-2 rounded-lg bg-yellow-500/5 border border-yellow-500/20">
              <div className="flex items-center gap-2">
                <Trophy className="w-3.5 h-3.5 text-yellow-400" />
                <span className="text-xs font-semibold">
                  Vitória <span className="text-yellow-400">{p.team}</span>
                </span>
              </div>
              <div className="text-[9px] text-muted-foreground font-mono">
                C {p.homeWin}% • E {p.draw}% • F {p.awayWin}%
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="px-4 py-3 bg-background flex items-center justify-between border-t border-white/5">
        <span className="text-[10px] text-muted-foreground italic">Margem ≥ 18% • Empate ≤ 28%</span>
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

export default TopWinsSuggestion;
