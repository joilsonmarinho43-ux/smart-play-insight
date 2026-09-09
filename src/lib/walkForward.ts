import { brierScore, logLoss, type ProbabilityObservation } from './probabilityIntegrity';

export interface WalkForwardRecord extends ProbabilityObservation {
  occurredAt: number;
  modelVersion: string;
}

export interface WalkForwardWindow {
  train: WalkForwardRecord[];
  test: WalkForwardRecord[];
}

export interface WalkForwardResult {
  windows: WalkForwardWindow[];
  testObservations: number;
  brierScore: number | null;
  logLoss: number | null;
  leakageDetected: boolean;
}

/**
 * Chronological walk-forward splitter. Test observations are always later
 * than the training boundary; no random shuffle is permitted.
 */
export function buildWalkForwardWindows(
  records: WalkForwardRecord[],
  trainSize: number,
  testSize: number,
): WalkForwardWindow[] {
  if (!Number.isInteger(trainSize) || !Number.isInteger(testSize) || trainSize <= 0 || testSize <= 0) return [];
  const sorted = [...records].sort((a, b) => a.occurredAt - b.occurredAt);
  const windows: WalkForwardWindow[] = [];
  for (let start = 0; start + trainSize < sorted.length; start += testSize) {
    const train = sorted.slice(0, start + trainSize);
    const test = sorted.slice(start + trainSize, start + trainSize + testSize);
    if (!test.length) break;
    const boundary = train[train.length - 1].occurredAt;
    if (test.some((r) => r.occurredAt <= boundary)) continue;
    windows.push({ train, test });
  }
  return windows;
}

export function evaluateWalkForward(windows: WalkForwardWindow[]): WalkForwardResult {
  const tests = windows.flatMap((w) => w.test);
  const leakageDetected = windows.some((w) => {
    const boundary = w.train[w.train.length - 1]?.occurredAt;
    return boundary === undefined || w.test.some((r) => r.occurredAt <= boundary);
  });
  const observations = tests.map(({ probability, occurred }) => ({ probability, occurred }));
  return {
    windows,
    testObservations: observations.length,
    brierScore: brierScore(observations),
    logLoss: logLoss(observations),
    leakageDetected,
  };
}
