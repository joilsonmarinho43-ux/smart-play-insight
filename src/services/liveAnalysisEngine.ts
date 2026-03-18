export interface LiveAnalysis {
  pressureSide: 'home' | 'away' | 'none';
  pressureIndex: number;
  goalProbability: number;
  recommendation: string;
  confidence: 'alta' | 'média' | 'baixa';
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function analyzeLive(match: any): LiveAnalysis | null {
  if (!match.isLive || !match.liveStats) return null;

  const stats = match.liveStats;

  const homePressure =
    (stats.dangerousAttacks?.[0] || 0) * 0.4 +
    (stats.corners?.[0] || 0) * 0.2 +
    (stats.possession?.[0] || 0) * 0.2 +
    (stats.pressureIndex?.[0] || 0) * 0.2;

  const awayPressure =
    (stats.dangerousAttacks?.[1] || 0) * 0.4 +
    (stats.corners?.[1] || 0) * 0.2 +
    (stats.possession?.[1] || 0) * 0.2 +
    (stats.pressureIndex?.[1] || 0) * 0.2;

  const diff = homePressure - awayPressure;

  let pressureSide: 'home' | 'away' | 'none' = 'none';

  if (diff > 15) pressureSide = 'home';
  else if (diff < -15) pressureSide = 'away';

  const totalPressure = homePressure + awayPressure;

  let goalProb = clamp((totalPressure / 100) * 100, 0, 100);

  if (match.minute) {
    if (match.minute > 60) goalProb *= 1.15;
    if (match.minute > 75) goalProb *= 1.25;
  }

  goalProb = clamp(goalProb, 0, 100);

  let recommendation = 'Sem entrada';
  let confidence: 'alta' | 'média' | 'baixa' = 'baixa';

  if (goalProb > 75 && pressureSide !== 'none') {
    recommendation = '🔥 Over 0.5 Gol (Live)';
    confidence = 'alta';
  } else if (goalProb > 65) {
    recommendation = '⚠️ Over 0.5 Gol (Aguardar odd)';
    confidence = 'média';
  }

  return {
    pressureSide,
    pressureIndex: Math.abs(diff),
    goalProbability: goalProb,
    recommendation,
    confidence,
  };
}
