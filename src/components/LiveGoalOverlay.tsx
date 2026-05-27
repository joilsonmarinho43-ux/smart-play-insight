import { Flame, Sparkles, AlertTriangle, Gauge } from 'lucide-react';
import type { LiveGoalRead } from '@/lib/liveGoalEngine';

interface Props {
  read: LiveGoalRead;
}

/**
 * Overlay compacto e responsivo para o card LIVE.
 * Mostra Pressure Score, tier, momento ideal, badges (Extrema/Value/Anti-FP)
 * e barra de intensidade ofensiva recente. Não substitui blocos existentes.
 */
const LiveGoalOverlay = ({ read }: Props) => {
  const tierColor =
    read.tier === 'elite' ? 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10' :
    read.tier === 'alta' ? 'text-cyan-400 border-cyan-500/40 bg-cyan-500/10' :
    read.tier === 'moderada' ? 'text-yellow-400 border-yellow-500/40 bg-yellow-500/10' :
    'text-red-400 border-red-500/40 bg-red-500/10';

  const scoreColor =
    read.pressureScore >= 80 ? 'text-emerald-400' :
    read.pressureScore >= 65 ? 'text-cyan-400' :
    read.pressureScore >= 50 ? 'text-yellow-400' : 'text-gray-400';

  return (
    <div className="mx-4 mb-2 mt-2 rounded-xl border border-[#30363D] bg-[#0D1117] overflow-hidden">
      <div className="px-3 py-2 flex items-center justify-between border-b border-[#30363D]">
        <div className="flex items-center gap-2">
          <Gauge className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
            Goal Pressure Engine
          </span>
        </div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${tierColor}`}>
          {read.tierLabel}
        </span>
      </div>

      <div className="px-3 py-2.5 grid grid-cols-[auto_1fr] gap-3 items-center">
        <div className="text-center">
          <p className={`text-2xl font-black tabular-nums leading-none ${scoreColor}`}>
            {read.pressureScore}
          </p>
          <p className="text-[9px] text-gray-500 uppercase mt-0.5">Pressure</p>
        </div>

        <div className="space-y-1.5 min-w-0">
          <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
            <span className="truncate">{read.momentLabel}</span>
            {read.leagueWeight !== 0 && (
              <span className={`ml-auto font-bold ${read.leagueWeight > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                Liga {read.leagueWeight > 0 ? '+' : ''}{read.leagueWeight}
              </span>
            )}
          </div>

          {/* Barra de intensidade ofensiva recente */}
          <div className="h-1.5 rounded-full bg-[#1f2937] overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 via-orange-400 to-red-500 transition-all"
              style={{ width: `${Math.min(100, Math.max(4, read.intensityBar))}%` }}
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {read.extremePressure && (
              <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/40 flex items-center gap-1 animate-pulse">
                <Flame className="w-3 h-3" /> Pressão Extrema
              </span>
            )}
            {read.valueOver && (
              <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> Value Over
              </span>
            )}
            {read.antiFalsePositive && (
              <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-300 border border-yellow-500/30 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> Falso Sinal
              </span>
            )}
            {read.recommendation && !read.antiFalsePositive && (
              <span className="ml-auto text-[10px] font-bold text-emerald-300 truncate">
                → {read.recommendation}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LiveGoalOverlay;
