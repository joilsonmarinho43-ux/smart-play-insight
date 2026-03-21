import { useMemo, useState } from 'react';
import { MatchData } from '@/types/match';
import { filterEliteMatches, EliteMatch, EliteTag, TAG_LABELS, TAG_COLORS } from '@/lib/eliteFilter';
import { Crown, ChevronDown, ChevronUp, Flame, Target } from 'lucide-react';
import MatchCard from './MatchCard';

interface Props {
  matches: MatchData[];
}

const FILTER_OPTIONS: { key: EliteTag | 'all'; label: string }[] = [
  { key: 'all', label: '🏆 Todos' },
  { key: 'goals', label: '⚽ Gols' },
  { key: 'corners', label: '⛳ Escanteios' },
  { key: 'cards', label: '🟨 Cartões' },
  { key: 'intense', label: '🔥 Intensos' },
];

const ElitePanel = ({ matches }: Props) => {
  const [expanded, setExpanded] = useState(true);
  const [activeFilter, setActiveFilter] = useState<EliteTag | 'all'>('all');

  const eliteMatches = useMemo(() => filterEliteMatches(matches), [matches]);

  const filtered = useMemo(() => {
    if (activeFilter === 'all') return eliteMatches;
    return eliteMatches.filter(e => e.tags.includes(activeFilter));
  }, [eliteMatches, activeFilter]);

  if (eliteMatches.length === 0) return null;

  return (
    <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-b from-amber-500/5 to-transparent overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-4 flex items-center justify-between bg-gradient-to-r from-amber-500/15 to-transparent hover:from-amber-500/25 transition-all"
      >
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-br from-amber-500 to-orange-600 p-2.5 rounded-xl shadow-lg shadow-amber-500/20">
            <Crown className="w-5 h-5 text-black" />
          </div>
          <div className="text-left">
            <h2 className="text-base font-black text-amber-400 tracking-tight uppercase">
              Elite Performance
            </h2>
            <p className="text-[10px] text-muted-foreground font-semibold uppercase">
              {eliteMatches.length} jogos selecionados • Alta probabilidade
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="bg-amber-500/20 text-amber-400 text-xs font-bold px-2 py-1 rounded-lg border border-amber-500/30">
            VIP
          </span>
          {expanded ? <ChevronUp className="text-amber-500" /> : <ChevronDown className="text-amber-500" />}
        </div>
      </button>

      {expanded && (
        <div className="p-4 space-y-4">
          {/* Filters */}
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {FILTER_OPTIONS.map(opt => (
              <button
                key={opt.key}
                onClick={() => setActiveFilter(opt.key)}
                className={`whitespace-nowrap text-[11px] font-bold px-3 py-1.5 rounded-lg border transition-all ${
                  activeFilter === opt.key
                    ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                    : 'bg-secondary/30 text-muted-foreground border-border hover:bg-secondary/50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Elite Match List */}
          <div className="space-y-3">
            {filtered.map((elite) => (
              <div key={elite.match.id} className="space-y-2">
                {/* Elite Score Bar */}
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-2">
                    <Flame className="w-3.5 h-3.5 text-amber-500" />
                    <span className="text-[11px] font-bold text-amber-400">
                      Score: {elite.eliteScore}%
                    </span>
                  </div>
                  <div className="flex gap-1.5">
                    {elite.tags.map(tag => (
                      <span
                        key={tag}
                        className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${TAG_COLORS[tag]}`}
                      >
                        {TAG_LABELS[tag]}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Score breakdown mini-bars */}
                <div className="grid grid-cols-4 gap-1 px-1">
                  {([
                    { label: 'Gols', val: elite.goalsScore, color: 'bg-green-500' },
                    { label: 'Cantos', val: elite.cornersScore, color: 'bg-blue-500' },
                    { label: 'Cartões', val: elite.cardsScore, color: 'bg-yellow-500' },
                    { label: 'Ritmo', val: elite.intensityScore, color: 'bg-red-500' },
                  ] as const).map(bar => (
                    <div key={bar.label} className="space-y-0.5">
                      <div className="flex justify-between">
                        <span className="text-[8px] text-muted-foreground">{bar.label}</span>
                        <span className="text-[8px] font-bold text-foreground">{bar.val}</span>
                      </div>
                      <div className="h-1 bg-secondary/50 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${bar.color} transition-all`}
                          style={{ width: `${Math.min(100, bar.val)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <MatchCard match={elite.match} />
              </div>
            ))}
          </div>

          {filtered.length === 0 && (
            <div className="text-center py-6">
              <Target className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                Nenhum jogo elite para este filtro
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ElitePanel;
