/**
 * Painel de probabilidades Over 0.5 / 1.5 / 2.5 / 3.5 gols
 * Calculado via Poisson para HT e FT
 * REGRA: Proibido exibir 0% ou 100% enquanto a bola estiver rolando
 * CORRIGIDO: Fator de conversão 0.10 (era 0.12)
 */

import type { LiveStats } from '@/lib/pressureEngine';

interface Props {
  homeStats: LiveStats | null;
  awayStats: LiveStats | null;
  homeGoals: number;
  awayGoals: number;
  minute: number;
}

function factorial(n: number): number {
  if (n <= 1) return 1;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function poissonPMF(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

function poissonCDF(lambda: number, maxK: number): number {
  let sum = 0;
  for (let k = 0; k <= maxK; k++) {
    sum += poissonPMF(lambda, k);
  }
  return sum;
}

function clampLive(prob: number): number {
  return Math.min(99, Math.max(1, prob));
}

function calculateOverProbs(
  homeStats: LiveStats | null,
  awayStats: LiveStats | null,
  homeGoals: number,
  awayGoals: number,
  minute: number,
  targetMinute: number
) {
  const h = homeStats || { shotsOnGoal: 0, possession: 50, corners: 0, dangerousAttacks: 0, totalShots: 0 };
  const a = awayStats || { shotsOnGoal: 0, possession: 50, corners: 0, dangerousAttacks: 0, totalShots: 0 };
  const safeMin = Math.max(minute, 1);
  const remaining = Math.max(targetMinute - minute, 0);

  if (remaining <= 0) {
    const totalGoals = homeGoals + awayGoals;
    return [0.5, 1.5, 2.5, 3.5].map(threshold => ({
      threshold,
      prob: totalGoals > threshold ? 99 : 1,
    }));
  }

  let totalLambda: number;

  const hasRealStats = (homeStats && h.totalShots > 0) || (awayStats && a.totalShots > 0);

  if (hasRealStats) {
    const homeConversion = h.totalShots > 0 ? h.shotsOnGoal / h.totalShots : 0.3;
    const awayConversion = a.totalShots > 0 ? a.shotsOnGoal / a.totalShots : 0.3;
    const homeShotsPerMin = h.totalShots / safeMin;
    const awayShotsPerMin = a.totalShots / safeMin;
    const homeLambda = homeShotsPerMin * homeConversion * remaining * 0.10;
    const awayLambda = awayShotsPerMin * awayConversion * remaining * 0.10;
    totalLambda = homeLambda + awayLambda;
  } else {
    // Fallback: estimate from goals already scored + league average (~2.5 goals/90)
    const goalsPerMin = (homeGoals + awayGoals) > 0
      ? (homeGoals + awayGoals) / safeMin
      : 2.5 / 90; // league average fallback
    totalLambda = goalsPerMin * remaining;
  }

  // Ensure minimum lambda for meaningful probabilities
  totalLambda = Math.max(totalLambda, 0.05);

  const currentTotal = homeGoals + awayGoals;

  return [0.5, 1.5, 2.5, 3.5].map(threshold => {
    const additionalNeeded = Math.max(0, Math.ceil(threshold) - currentTotal);
    if (additionalNeeded <= 0) {
      return { threshold, prob: 99 };
    }
    const probUnder = poissonCDF(totalLambda, additionalNeeded - 1);
    const probOver = clampLive(Math.round((1 - probUnder) * 100));
    return { threshold, prob: probOver };
  });
}

function getBarColor(prob: number): string {
  if (prob >= 75) return 'bg-emerald-500';
  if (prob >= 50) return 'bg-emerald-500/60';
  if (prob >= 30) return 'bg-yellow-500/60';
  return 'bg-red-500/40';
}

function getTextColor(prob: number): string {
  if (prob >= 75) return 'text-emerald-400';
  if (prob >= 50) return 'text-emerald-300';
  if (prob >= 30) return 'text-yellow-400';
  return 'text-red-400';
}

const OverGoalsPanel = ({ homeStats, awayStats, homeGoals, awayGoals, minute }: Props) => {
  const htProbs = calculateOverProbs(homeStats, awayStats, homeGoals, awayGoals, minute, 45);
  const ftProbs = calculateOverProbs(homeStats, awayStats, homeGoals, awayGoals, minute, 90);

  return (
    <div className="bg-[#161B22] rounded-xl border border-[#30363D] overflow-hidden">
      <div className="grid grid-cols-2 divide-x divide-[#30363D]">
        <div className="p-3">
          <p className="text-[9px] font-bold text-cyan-400 uppercase tracking-wider mb-2 text-center">⏱ Gols HT</p>
          <div className="space-y-1.5">
            {htProbs.map(({ threshold, prob }) => (
              <div key={`ht-${threshold}`} className="flex items-center gap-2">
                <span className="text-[9px] text-gray-500 font-mono w-10 text-right">O {threshold}</span>
                <div className="flex-1 h-3 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${getBarColor(prob)}`}
                    style={{ width: `${prob}%` }}
                  />
                </div>
                <span className={`text-[10px] font-bold font-mono tabular-nums w-8 text-right ${getTextColor(prob)}`}>
                  {prob}%
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="p-3">
          <p className="text-[9px] font-bold text-orange-400 uppercase tracking-wider mb-2 text-center">⚽ Gols FT</p>
          <div className="space-y-1.5">
            {ftProbs.map(({ threshold, prob }) => (
              <div key={`ft-${threshold}`} className="flex items-center gap-2">
                <span className="text-[9px] text-gray-500 font-mono w-10 text-right">O {threshold}</span>
                <div className="flex-1 h-3 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${getBarColor(prob)}`}
                    style={{ width: `${prob}%` }}
                  />
                </div>
                <span className={`text-[10px] font-bold font-mono tabular-nums w-8 text-right ${getTextColor(prob)}`}>
                  {prob}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default OverGoalsPanel;
