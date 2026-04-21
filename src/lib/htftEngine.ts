/**
 * HT/FT STRATEGY ENGINE — Estratégias de Intervalo e Final
 * Analisa tendências do 1º tempo para projetar o resultado final
 */

import type { LiveStats } from './pressureEngine';

export interface HtFtPrediction {
  htResult: string;     // "Casa" | "Empate" | "Fora"
  ftResult: string;     // "Casa" | "Empate" | "Fora"
  label: string;        // e.g. "Casa/Casa"
  probability: number;  // 0-100
  reason: string;
  signal: 'entry' | 'wait' | 'caution';
}

export function calculateHtFtStrategy(
  homeStats: LiveStats | null,
  awayStats: LiveStats | null,
  homeGoals: number,
  awayGoals: number,
  minute: number,
  homeName: string,
  awayName: string,
  ap5Home: number,
  ap5Away: number
): HtFtPrediction[] {
  const predictions: HtFtPrediction[] = [];

  try {
    const h = homeStats || { shotsOnGoal: 0, possession: 50, corners: 0, dangerousAttacks: 0, totalShots: 0 };
    const a = awayStats || { shotsOnGoal: 0, possession: 50, corners: 0, dangerousAttacks: 0, totalShots: 0 };
    const safeMin = Math.max(minute, 1);

    // Determine current HT result
    const htResult = homeGoals > awayGoals ? 'Casa' : homeGoals < awayGoals ? 'Fora' : 'Empate';
    const htName = homeGoals > awayGoals ? homeName : homeGoals < awayGoals ? awayName : 'Empate';

    // Calculate offensive power for FT projection
    const hDA = h.dangerousAttacks > 0 ? h.dangerousAttacks : Math.round((h.totalShots || 0) * 1.5 + (h.corners || 0) * 2);
    const aDA = a.dangerousAttacks > 0 ? a.dangerousAttacks : Math.round((a.totalShots || 0) * 1.5 + (a.corners || 0) * 2);
    const homePower = h.shotsOnGoal * 4 + h.totalShots * 1.5 + hDA * 0.8 + h.corners * 1.2 + (h.possession > 55 ? 8 : 0);
    const awayPower = a.shotsOnGoal * 4 + a.totalShots * 1.5 + aDA * 0.8 + a.corners * 1.2 + (a.possession > 55 ? 8 : 0);
    const totalPower = homePower + awayPower || 1;
    const homeShare = (homePower / totalPower) * 100;

    // Goal diff advantage
    const goalDiff = homeGoals - awayGoals;

    // ═══ FIRST HALF (minute < 45) — Predict HT result ═══
    if (minute < 45 && minute >= 15) {
      if (goalDiff !== 0) {
        // Someone is winning — will they hold until HT?
        const leader = goalDiff > 0 ? homeName : awayName;
        const leaderShare = goalDiff > 0 ? homeShare : 100 - homeShare;
        const trailing = goalDiff > 0 ? awayName : homeName;
        const trailingAP5 = goalDiff > 0 ? ap5Away : ap5Home;
        const remainToHT = 45 - minute;

        if (trailingAP5 < 50 || remainToHT < 10) {
          const conf = Math.min(82, 55 + Math.abs(goalDiff) * 8 + Math.floor((45 - remainToHT) / 5));
          predictions.push({
            htResult: goalDiff > 0 ? 'Casa' : 'Fora',
            ftResult: goalDiff > 0 ? 'Casa' : 'Fora',
            label: `${leader} / ${leader}`,
            probability: conf,
            reason: `${leader} vencendo ${homeGoals}-${awayGoals} com ${leaderShare.toFixed(0)}% do domínio. ${trailing} sem pressão (AP5: ${trailingAP5.toFixed(0)}).`,
            signal: conf >= 65 ? 'entry' : 'wait',
          });
        } else {
          const conf = Math.min(70, 40 + Math.floor(trailingAP5 / 3));
          predictions.push({
            htResult: goalDiff > 0 ? 'Casa' : 'Fora',
            ftResult: 'Empate',
            label: `${leader} / Empate`,
            probability: conf,
            reason: `${leader} vence ${homeGoals}-${awayGoals} mas ${trailing} pressiona (AP5: ${trailingAP5.toFixed(0)}). Possível empate no FT.`,
            signal: 'wait',
          });
        }
      } else {
        // Draw at HT
        if (Math.abs(homeShare - 50) >= 15) {
          const dominant = homeShare > 50 ? homeName : awayName;
          const domShare = homeShare > 50 ? homeShare : 100 - homeShare;
          const domAP5 = homeShare > 50 ? ap5Home : ap5Away;
          const conf = Math.min(72, 40 + Math.floor(domShare / 3) + Math.floor(domAP5 / 5));
          predictions.push({
            htResult: 'Empate',
            ftResult: homeShare > 50 ? 'Casa' : 'Fora',
            label: `Empate / ${dominant}`,
            probability: conf,
            reason: `Empate ${homeGoals}-${awayGoals} mas ${dominant} domina com ${domShare.toFixed(0)}% e AP5 ${domAP5.toFixed(0)}. Tendência de gol no 2T.`,
            signal: conf >= 60 ? 'entry' : 'wait',
          });
        } else {
          predictions.push({
            htResult: 'Empate',
            ftResult: 'Empate',
            label: 'Empate / Empate',
            probability: Math.min(65, 35 + Math.floor(minute / 3)),
            reason: `Jogo equilibrado: ${homeGoals}-${awayGoals}. Posse ${h.possession}%-${a.possession}%. Sem tendência clara.`,
            signal: 'wait',
          });
        }
      }
    }

    // ═══ SECOND HALF (minute >= 45) — Predict FT result ═══
    if (minute >= 45) {
      const remaining = 90 - minute;
      const htLabel = homeGoals > awayGoals ? 'Casa' : homeGoals < awayGoals ? 'Fora' : 'Empate';

      if (goalDiff !== 0) {
        const leader = goalDiff > 0 ? homeName : awayName;
        const trailing = goalDiff > 0 ? awayName : homeName;
        const trailingAP5 = goalDiff > 0 ? ap5Away : ap5Home;
        const leaderShare = goalDiff > 0 ? homeShare : 100 - homeShare;

        // Leader maintains?
        if (trailingAP5 < 55 || remaining < 15) {
          const conf = Math.min(85, 50 + Math.abs(goalDiff) * 10 + Math.floor((90 - remaining) / 3));
          const ftLabel = goalDiff > 0 ? 'Casa' : 'Fora';
          predictions.push({
            htResult: htLabel,
            ftResult: ftLabel,
            label: `${htLabel === ftLabel ? `${leader} / ${leader}` : `${htLabel} / ${leader}`}`,
            probability: conf,
            reason: `${leader} vence ${homeGoals}-${awayGoals} aos ${minute}'. ${trailing} sem reação (AP5: ${trailingAP5.toFixed(0)}). ${remaining}' restantes.`,
            signal: conf >= 70 ? 'entry' : 'wait',
          });
        }

        // Trailing team comeback?
        if (trailingAP5 >= 60 && remaining >= 15) {
          const conf = Math.min(68, 35 + Math.floor(trailingAP5 / 3) + Math.floor(remaining / 5));
          predictions.push({
            htResult: htLabel,
            ftResult: 'Empate',
            label: `${htLabel} / Empate`,
            probability: conf,
            reason: `${trailing} pressiona forte (AP5: ${trailingAP5.toFixed(0)}) com ${remaining}' restantes. Empate possível.`,
            signal: conf >= 55 ? 'entry' : 'wait',
          });
        }
      } else {
        // Draw in 2nd half
        if (Math.abs(homeShare - 50) >= 18) {
          const dominant = homeShare > 50 ? homeName : awayName;
          const domAP5 = homeShare > 50 ? ap5Home : ap5Away;
          const conf = Math.min(70, 38 + Math.floor(domAP5 / 3) + Math.floor(remaining / 4));
          predictions.push({
            htResult: 'Empate',
            ftResult: homeShare > 50 ? 'Casa' : 'Fora',
            label: `Empate / ${dominant}`,
            probability: conf,
            reason: `Empate ${homeGoals}-${awayGoals} mas ${dominant} pressiona com AP5 ${domAP5.toFixed(0)} e ${remaining}' restantes.`,
            signal: conf >= 60 ? 'entry' : 'wait',
          });
        }

        if (remaining <= 20) {
          const conf = Math.min(78, 45 + Math.floor((90 - remaining) / 2));
          predictions.push({
            htResult: 'Empate',
            ftResult: 'Empate',
            label: 'Empate / Empate',
            probability: conf,
            reason: `Empate ${homeGoals}-${awayGoals} aos ${minute}'. Apenas ${remaining}' restantes. Tendência de manutenção.`,
            signal: conf >= 65 ? 'entry' : 'wait',
          });
        }
      }
    }
  } catch (e) {
    console.error('HT/FT strategy error:', e);
  }

  return predictions.sort((a, b) => b.probability - a.probability).slice(0, 2);
}
