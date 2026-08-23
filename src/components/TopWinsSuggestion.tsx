import { useMemo } from 'react';
import { MatchData } from '@/types/match';
import { Trophy, Copy, MessageCircle, Crown } from 'lucide-react';
import { toast } from 'sonner';
import { isBookmakerLeague } from '@/lib/bookmakerLeagues';
import { isUpcomingMatch } from '@/lib/matchTiming';

function fact(n: number): number { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }
function pois(l: number, k: number): number { return (Math.exp(-l) * Math.pow(l, k)) / fact(k); }

function computeWinProbs(m: MatchData): { home: number; draw: number; away: number } {
  const hStats: any = (m as any).homeStats || {};
  const aStats: any = (m as any).awayStats || {};
  const hGF = m.modelData?.homeGoalsAvg ?? hStats.goalsFor ?? 0;
  const aGF = m.modelData?.awayGoalsAvg ?? aStats.goalsFor ?? 0;
  const hGA = m.modelData?.homeGoalsAgainstAvg ?? hStats.goalsAgainst ?? 0;
  const aGA = m.modelData?.awayGoalsAgainstAvg ?? aStats.goalsAgainst ?? 0;
  const leagueAvg = hStats.leagueAvg || aStats.leagueAvg || 1.30;
  const hN = m.sampleSize?.homeGames || hStats.gamesCount || 0;
  const aN = m.sampleSize?.awayGames || aStats.gamesCount || 0;
  const k = 3;
  const bay = (avg: number, n: number) => n === 0 ? leagueAvg : (n * avg + k * leagueAvg) / (n + k);
  const adjHGF = bay(hGF, hN), adjAGA = bay(aGA, aN), adjAGF = bay(aGF, aN), adjHGA = bay(hGA, hN);
  const hL = (adjHGF / leagueAvg) * (adjAGA / leagueAvg) * leagueAvg;
  const aL = (adjAGF / leagueAvg) * (adjHGA / leagueAvg) * leagueAvg;
  let pH = 0, pD = 0, pA = 0;
  for (let h = 0; h <= 7; h++) {
    for (let a = 0; a <= 7; a++) {
      const p = pois(hL, h) * pois(aL, a);
      if (h > a) pH += p; else if (h === a) pD += p; else pA += p;
    }
  }
  return { home: Math.round(pH * 100), draw: Math.round(pD * 100), away: Math.round(pA * 100) };
}


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
  if (UNSTABLE.some(t => l.includes(t))) return false;
  // Jogo já iniciado/encerrado não existe mais na casa de aposta
  if (!isUpcomingMatch(m)) return false;
  // Só sugere jogos que existem nas casas de aposta
  return isBookmakerLeague(m.league || '');
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
      const probs = computeWinProbs(m);
      const homeP = probs.home;
      const awayP = probs.away;
      const drawP = probs.draw;

      const best = homeP >= awayP ? { side: 'home' as const, prob: homeP } : { side: 'away' as const, prob: awayP };
      const margin = Math.abs(homeP - awayP);

      // Filtros realistas: favorito claro com folga
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

  if (picks.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center">
        <Crown className="w-8 h-8 text-orange-400/60 mx-auto mb-3" />
        <h3 className="text-sm font-bold text-white mb-1">Nenhuma entrada aprovada hoje</h3>
        <p className="text-xs text-gray-500 leading-relaxed">
          Analisamos {matches?.length ?? 0} jogos. Só entram ligas com mercado nas casas de aposta
          (favorito ≥ 45%, margem ≥ 12% e empate ≤ 35%, com histórico de pelo menos 4 jogos por equipe) e apenas partidas que ainda não começaram.
        </p>
      </div>
    );
  }

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
        <span className="text-[10px] text-muted-foreground italic">Margem ≥ 12% • Empate ≤ 35%</span>
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
