import { useMemo } from 'react';
import { ScannerOpportunity } from '@/lib/scannerEngine';
import { scanMatches } from '@/lib/scannerEngine';
import { MatchData } from '@/types/match';
import { Badge } from '@/components/ui/badge';
import { Crosshair, Flame, Zap, AlertTriangle, TrendingUp } from 'lucide-react';

interface ScannerProPanelProps {
  matches: MatchData[];
  cacheKey?: string; // to memoize based on data change
}

function getPriorityBadge(score: number) {
  if (score > 0.75) return { label: '🔥 Alta', className: 'bg-red-500/20 text-red-400 border-red-500/30' };
  if (score >= 0.65) return { label: '⚡ Média', className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' };
  return { label: '⚠️ Baixa', className: 'bg-gray-500/20 text-gray-400 border-gray-500/30' };
}

export default function ScannerProPanel({ matches, cacheKey }: ScannerProPanelProps) {
  const opportunities = useMemo(() => scanMatches(matches), [matches, cacheKey]);

  if (opportunities.length === 0) return null;

  return (
    <div className="rounded-2xl border border-orange-500/20 bg-black/40 backdrop-blur-md overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-orange-500/15 to-red-500/10 border-b border-orange-500/20">
        <Crosshair className="w-5 h-5 text-orange-500" />
        <h2 className="text-sm font-black uppercase tracking-wider text-orange-400">
          Scanner PRO
        </h2>
        <Badge className="ml-auto bg-orange-500/20 text-orange-300 border-orange-500/30 text-[10px]">
          {opportunities.length} OPORTUNIDADES
        </Badge>
      </div>

      {/* Opportunities */}
      <div className="divide-y divide-white/5">
        {opportunities.map((opp, i) => {
          const badge = getPriorityBadge(opp.score);
          return (
            <div key={`${opp.matchId}-${opp.opportunity}-${i}`} className="px-4 py-3 hover:bg-white/5 transition-colors">
              {/* Row 1: Match + Signal */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-mono text-orange-500/60">#{i + 1}</span>
                  <span className="text-sm font-bold text-white truncate">{opp.match}</span>
                </div>
                {opp.signal && (
                  <span className="shrink-0 flex items-center gap-1 text-[11px] font-black text-red-400 animate-pulse">
                    <Flame className="w-3.5 h-3.5" />
                    {opp.signal}
                  </span>
                )}
              </div>

              {/* Row 2: League + Minute */}
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] text-gray-500">{opp.league}</span>
                {opp.minute != null && (
                  <span className="text-[10px] text-green-400 font-mono">{opp.minute}'</span>
                )}
              </div>

              {/* Row 3: Stats */}
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                {/* Opportunity type */}
                <Badge className="bg-orange-500/15 text-orange-300 border-orange-500/25 text-[11px] font-bold">
                  {opp.opportunity}
                </Badge>

                {/* Priority */}
                <Badge className={`${badge.className} text-[10px]`}>
                  {badge.label}
                </Badge>

                {/* Probability */}
                <div className="flex items-center gap-1">
                  <TrendingUp className="w-3 h-3 text-emerald-400" />
                  <span className="text-xs font-bold text-emerald-400">{opp.probability}%</span>
                </div>

                {/* EV */}
                <span className={`text-[11px] font-mono ${opp.ev > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  EV {opp.ev > 0 ? '+' : ''}{opp.ev}
                </span>

                {/* Pressure */}
                <div className="flex items-center gap-1">
                  <Zap className="w-3 h-3 text-yellow-400" />
                  <span className="text-[11px] text-yellow-400">{opp.pressure}</span>
                </div>

                {/* Score */}
                <span className="text-[10px] text-gray-500 ml-auto">
                  Score: {opp.score}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 bg-black/30 border-t border-white/5">
        <p className="text-[9px] text-gray-600 text-center">
          Apenas oportunidades com probabilidade ≥60% e EV positivo • Atualiza automaticamente
        </p>
      </div>
    </div>
  );
}
