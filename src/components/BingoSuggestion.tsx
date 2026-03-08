import { useMemo, useState } from 'react';
import { MatchData, MarketAnalysis } from '@/types/match';
import { analyzeMarkets } from '@/lib/matchAnalysis';
import { Sparkles, Trophy, TrendingUp, Zap, AlertTriangle, Ticket, Clock, Copy, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  matches: MatchData[];
}

interface BingoMatch {
  match: MatchData;
  markets: MarketAnalysis[];
}

const categoryIcons: Record<string, typeof TrendingUp> = {
  goals: TrendingUp,
  corners: Zap,
  cards: AlertTriangle,
  result: Trophy,
};

// Thresholds realistas por tipo de mercado
// Over 1.5 Gols é "fácil" → exige >= 82% para ter valor real
// Vitória é difícil → 55% já é sinal forte
const MARKET_THRESHOLDS: Record<string, number> = {
  'Over 1.5 Gols': 82,
  'Over 5.5 Escanteios': 65,
  'Over 2.5 Cartões': 65,
  'chanceDupla': 72,
  'vitoria': 55,
};

function getBingoMarkets(match: MatchData): MarketAnalysis[] {
  const all = analyzeMarkets(match);
  const picked: MarketAnalysis[] = [];

  // Over 1.5 Gols
  const o15 = all.find((m) => m.market === 'Over 1.5 Gols');
  if (o15 && o15.probability >= MARKET_THRESHOLDS['Over 1.5 Gols']) {
    picked.push(o15);
  }

  // Over 5.5 Escanteios
  const o55c = all.find((m) => m.market === 'Over 5.5 Escanteios');
  if (o55c && o55c.probability >= MARKET_THRESHOLDS['Over 5.5 Escanteios']) {
    picked.push(o55c);
  }

  // Over 2.5 Cartões
  const o25k = all.find((m) => m.market === 'Over 2.5 Cartões');
  if (o25k && o25k.probability >= MARKET_THRESHOLDS['Over 2.5 Cartões']) {
    picked.push(o25k);
  }

  // Chance Dupla — pega a melhor (1X ou X2)
  const cd = all
    .filter((m) => m.market.startsWith('1X') || m.market.startsWith('X2'))
    .sort((a, b) => b.probability - a.probability)[0];
  if (cd && cd.probability >= MARKET_THRESHOLDS['chanceDupla']) {
    picked.push(cd);
  }

  // Vitória — pega a mais provável
  const vit = all
    .filter((m) => m.market.startsWith('Vitória'))
    .sort((a, b) => b.probability - a.probability)[0];
  if (vit && vit.probability >= MARKET_THRESHOLDS['vitoria']) {
    picked.push(vit);
  }

  return picked;
}

const riskColors: Record<string, string> = {
  'Baixo': 'bg-green-500/20 text-green-400 border-green-500/30',
  'Médio': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  'Alto': 'bg-red-500/20 text-red-400 border-red-500/30',
};

const BingoSuggestion = ({ matches }: Props) => {
  const bingoMatches = useMemo(() => {
    const results: BingoMatch[] = [];

    for (const match of matches) {
      const markets = getBingoMarkets(match);
      if (markets.length > 0) {
        results.push({ match, markets });
      }
    }

    // Ordena por quantidade de mercados qualificados (mais = melhor jogo)
    return results.sort((a, b) => b.markets.length - a.markets.length);
  }, [matches]);

  if (bingoMatches.length === 0) return null;

  const totalSelections = bingoMatches.reduce((acc, bm) => acc + bm.markets.length, 0);

  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-card rounded-2xl border border-primary/30 overflow-hidden mb-6 animate-slide-in">
      {/* Header - always visible, clickable to toggle */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full bg-primary/10 px-4 sm:px-6 py-3 flex items-center justify-between border-b border-primary/20 hover:bg-primary/15 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          <h2 className="font-display text-lg sm:text-xl text-primary tracking-wider">
            BINGO DO DIA
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs bg-primary/20 text-primary px-2.5 py-1 rounded-full font-semibold">
            {bingoMatches.length} jogos • {totalSelections} entradas
          </span>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-primary" />
          ) : (
            <ChevronDown className="w-4 h-4 text-primary" />
          )}
        </div>
      </button>

      {expanded && (
        <>
      {/* Thresholds info */}
      <div className="px-4 sm:px-6 pt-3 pb-1">
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Filtros: Over 1.5 Gols ≥82% · Over 5.5 Escanteios ≥65% · Over 2.5 Cartões ≥65% · Chance Dupla ≥72% · Vitória ≥55%
        </p>
      </div>

      {/* Match groups */}
      <div className="px-4 sm:px-6 py-3 space-y-3">
        {bingoMatches.map((bm, idx) => (
          <div key={idx} className="rounded-lg border border-border/60 overflow-hidden">
            {/* Match header */}
            <div className="bg-secondary/50 px-3 py-2 flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <Trophy className="w-3.5 h-3.5 text-primary shrink-0" />
                <span className="text-xs font-bold text-foreground truncate">
                  {bm.match.homeTeam} vs {bm.match.awayTeam}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Clock className="w-3 h-3 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground">{bm.match.time}</span>
                <span className="text-[10px] text-muted-foreground/60 ml-1">{bm.match.league}</span>
              </div>
            </div>

            {/* Markets for this match */}
            <div className="divide-y divide-border/30">
              {bm.markets.map((market, mi) => {
                const Icon = categoryIcons[market.category] || Ticket;
                const probColor =
                  market.probability >= 80 ? 'text-green-400' :
                  market.probability >= 65 ? 'text-yellow-400' :
                  'text-orange-400';

                return (
                  <div key={mi} className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <span className="text-xs font-semibold text-foreground block truncate">
                          {market.market}
                        </span>
                        <span className="text-[10px] text-muted-foreground/70 block truncate">
                          {market.statisticalBasis}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${riskColors[market.risk]}`}>
                        {market.risk}
                      </span>
                      <span className={`font-bold text-sm ${probColor} w-14 text-right`}>
                        {market.probability}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="bg-secondary/30 border-t border-border px-4 sm:px-6 py-2.5 flex items-center justify-between">
        <p className="text-[10px] text-muted-foreground">
          Poisson (gols) + média ponderada (escanteios/cartões) • 60% temporada + 40% últimos 10
        </p>
        <button
          onClick={() => {
            const lines = ['🎯 *BINGO DO DIA — ANALISTA PRO 8.0*', ''];
            for (const bm of bingoMatches) {
              lines.push(`⚽ *${bm.match.homeTeam} vs ${bm.match.awayTeam}*`);
              lines.push(`🕐 ${bm.match.time} • ${bm.match.league}`);
              for (const m of bm.markets) {
                const icon = m.category === 'goals' ? '📊' : m.category === 'corners' ? '🔄' : m.category === 'cards' ? '🟨' : '🏆';
                lines.push(`  ${icon} ${m.market} — *${m.probability}%* (${m.risk})`);
              }
              lines.push('');
            }
            lines.push(`📈 ${bingoMatches.length} jogos • ${totalSelections} entradas`);
            lines.push('_Modelo estatístico Poisson + média ponderada_');
            navigator.clipboard.writeText(lines.join('\n'));
            toast.success('Bingo copiado para a área de transferência!');
          }}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-primary/20 text-primary hover:bg-primary/30 transition-colors shrink-0"
        >
          <Copy className="w-3.5 h-3.5" />
          Copiar
        </button>
      </div>
    </div>
  );
};

export default BingoSuggestion;
