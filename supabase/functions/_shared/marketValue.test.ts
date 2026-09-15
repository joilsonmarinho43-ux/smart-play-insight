import { computeObservedMarketValue } from './marketValue.ts';

Deno.test('computes implied probability and EV from observed odd', () => {
  const value = computeObservedMarketValue(60, 2.0);
  if (!value) throw new Error('expected valid market value');
  if (Math.abs(value.impliedProbability - 50) > 1e-9) throw new Error(`unexpected implied probability: ${value.impliedProbability}`);
  if (Math.abs(value.expectedValue - 0.2) > 1e-9) throw new Error(`unexpected EV: ${value.expectedValue}`);
});

Deno.test('rejects invalid or missing observed odd', () => {
  if (computeObservedMarketValue(60, 1) !== null) throw new Error('odd <= 1 must be rejected');
  if (computeObservedMarketValue(60, Number.NaN) !== null) throw new Error('NaN odd must be rejected');
});

Deno.test('does not manufacture a market odd from model probability', () => {
  const value = computeObservedMarketValue(60, 2.5);
  if (!value) throw new Error('expected valid market value');
  if (Math.abs(value.expectedValue - 0.5) > 1e-9) throw new Error('EV must use the supplied observed odd');
});
