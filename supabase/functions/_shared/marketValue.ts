export interface ObservedMarketValue {
  impliedProbability: number;
  expectedValue: number;
}

/**
 * Converts an independently produced model probability plus a REAL observed
 * decimal odd into the market-implied probability and EV.
 *
 * This function deliberately does not manufacture an odd from the model.
 */
export function computeObservedMarketValue(modelProbability: number, observedOdd: number): ObservedMarketValue | null {
  if (!Number.isFinite(modelProbability) || modelProbability < 0 || modelProbability > 100) return null;
  if (!Number.isFinite(observedOdd) || observedOdd <= 1) return null;

  const impliedProbability = 100 / observedOdd;
  const expectedValue = Number(((modelProbability / 100) * observedOdd - 1).toFixed(6));

  return { impliedProbability, expectedValue };
}
