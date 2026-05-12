import { useMemo, useState } from 'react';
import { ScannerOpportunity, getScannerLogs } from '@/lib/scannerEngine';
import { scanMatches } from '@/lib/scannerEngine';
import { MatchData } from '@/types/match';
import { Badge } from '@/components/ui/badge';
import { Crosshair, Flame, Zap, TrendingUp, ShieldCheck, AlertTriangle, ChevronDown, ChevronUp, Clock } from 'lucide-react';
import { formatDateTimePara } from '@/lib/timezone';

interface ScannerProPanelProps {
  matches: MatchData[];
  cacheKey?: string;
}

function getPriorityBadge(score: number) {
  if (score > 0.75) return { label: '🔥 Alta', className: 'bg-red-500/20 text-red-400 border-red-500/30' };
  if (score >= 0.65) return { label: '⚡ Média', className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' };
  return { label: '⚠️ Baixa', className: 'bg-gray-500/20 text-gray-400 border-gray-500/30' };
}

function getDataQualityIcon(quality: string) {
  if (quality === 'high') return <ShieldCheck className="w-3 h-3 text-emerald-400" />;
  if (quality === 'medium') return <AlertTriangle className="w-3 h-3 text-yellow-400" />;
  return <AlertTriangle className="w-3 h-3 text-red-400" />;
}

export default function ScannerProPanel({ matches, cacheKey }: ScannerProPanelProps) {
  const opportunities = useMemo(() => scanMatches(matches), [matches, cacheKey]);
  const [showLogs, setShowLogs] = useState(false);

  if (opportunities.length === 0) {
    return (
      <div className="rounded-2xl border border-orange-500/20 bg-black/40 backdrop-blur-md overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-orange-500/15 to-red-500/10 border-b border-orange-500/20">
          <Crosshair className="w-5 h-5 text-orange-500" />
          <h2 className="text-sm font-black uppercase tracking-wider text-orange-400">
            Scanner PRO
          </h2>
        </div>
        <div className="px-4 py-6 text-center">
          <p className="text-xs text-gray-500">Nenhuma oportunidade encontrada com os filtros atuais.</p>
          <p className="text-[10px] text-gray-600 mt-1">
            {matches.length} jogos analisados • Probabilidade mínima 60% + EV positivo
          </p>
        </div>
      </div>
    );
  }

  const liveCount = opportunities.filter(o => o.isLive).length;
  const preCount = opportunities.filter(o => !o.isLive).length;

  return (
    <div className="rounded-2xl border border-orange-500/20 bg-black/40 backdrop-blur-md overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-orange-500/15 to-red-500/10 border-b border-orange-500/20">
        <Crosshair className="w-5 h-5 text-orange-500" />
        <h2 className="text-sm font-black uppercase tracking-wider text-orange-400">
          Scanner PRO
        </h2>
        <div className="ml-auto flex items-center gap-2">
          {liveCount > 0 && (
            <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-[10px]">
              {liveCount} LIVE
            </Badge>
          )}
          <Badge className="bg-orange-500/20 text-orange-300 border-orange-500/30 text-[10px]">
            {opportunities.length} OPORTUNIDADES
          </Badge>
        </div>
      </div>

      {/* Opportunities */}
      <div className="divide-y divide-white/5">
        {opportunities.map((opp, i) => {
          const badge = getPriorityBadge(opp.score);
          return (
            <div key={`${opp.matchId}-${opp.opportunity}-${i}`} className="px-4 py-3 hover:bg-white/5 transition-colors">
              {/* Row 1: Match + Signal */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-orange-500/60">#{i + 1}</span>
                  <span className="text-sm font-bold text-white break-words">{opp.match}</span>
                  {getDataQualityIcon(opp.dataQuality)}
                </div>
                {opp.signal && (
                  <span className="flex items-center gap-1 text-[11px] font-black text-red-400 animate-pulse">
                    <Flame className="w-3.5 h-3.5" />
                    {opp.signal}
                  </span>
                )}
              </div>

              {/* Row 2: League + Minute + Live badge */}
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] text-gray-500">{opp.league}</span>
                {opp.isLive && (
                  <span className="text-[9px] font-bold bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded">LIVE</span>
                )}
                {opp.minute != null && (
                  <span className="text-[10px] text-green-400 font-mono">{opp.minute}'</span>
                )}
              </div>

              {/* Row 3: Stats */}
                <div className="flex items-center gap-3 mt-2 flex-wrap">
                <Badge className="bg-orange-500/15 text-orange-300 border-orange-500/25 text-[11px] font-bold">
                  {opp.opportunity}
                </Badge>

                {opp.rmaVerdict && (
                  <span title={`RMA: ${opp.rmaVerdict} (${opp.rmaScore ?? '-'})`} className="text-sm">
                    {opp.rmaVerdict === 'CONFIRMADO' ? '🟢' : opp.rmaVerdict === 'BLOQUEADO' ? '🔴' : '🟡'}
                  </span>
                )}

                <Badge className={`${badge.className} text-[10px]`}>
                  {badge.label}
                </Badge>

                <div className="flex items-center gap-1">
                  <TrendingUp className="w-3 h-3 text-emerald-400" />
                  <span className="text-xs font-bold text-emerald-400">{opp.probability}%</span>
                </div>

                <span className={`text-[11px] font-mono ${opp.ev > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  EV {opp.ev > 0 ? '+' : ''}{opp.ev}
                </span>

                <div className="flex items-center gap-1">
                  <Zap className="w-3 h-3 text-yellow-400" />
                  <span className="text-[11px] text-yellow-400">{opp.pressure}</span>
                </div>

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
        <div className="flex items-center justify-between">
          <p className="text-[9px] text-gray-600">
            Apenas oportunidades com probabilidade ≥60% e EV positivo • Atualiza automaticamente
          </p>
          <button
            onClick={() => setShowLogs(!showLogs)}
            className="text-[9px] text-gray-600 hover:text-gray-400 flex items-center gap-1"
          >
            Logs {showLogs ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>
        
        {showLogs && (
          <div className="mt-2 max-h-24 overflow-y-auto text-[9px] font-mono text-gray-600 space-y-0.5">
            {getScannerLogs().slice(-10).map((log, i) => (
              <div key={i} className={log.type === 'error' ? 'text-red-400' : log.type === 'warn' ? 'text-yellow-400' : ''}>
                [{log.type.toUpperCase()}] {log.message}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
