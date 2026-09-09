import { describe, expect, it } from 'vitest';
import { calculateAnalyticalValue, calculateMarketAnalyticalValue } from '@/lib/analyticalValue';

const baseMarket = {
  market: 'Over 1.5 Gols',
  probability: 80,
  risk: 'baixo',
  category: 'goals',
};

describe('analyticalValue', () => {
  it('não inventa EV quando não existe odd real', () => {
    const value = calculateMarketAnalyticalValue(baseMarket);
    expect(value.available).toBe(false);
    expect(value.ev).toBeNull();
    expect(value.marketOdd).toBeNull();
    expect(value.reason).toBe('MARKET_ODD_MISSING');
    expect(value.fairOdd).toBe(1.25);
  });

  it('calcula EV somente com odd observada', () => {
    const value = calculateMarketAnalyticalValue({ ...baseMarket, odd: 1.4 });
    expect(value.available).toBe(true);
    expect(value.ev).toBe(0.12);
    expect(value.marketOdd).toBe(1.4);
  });

  it('rejeita odd inválida', () => {
    const value = calculateAnalyticalValue(80, 1);
    expect(value.available).toBe(false);
    expect(value.ev).toBeNull();
    expect(value.reason).toBe('INVALID_ODD');
  });

  it('rejeita probabilidade inválida', () => {
    const value = calculateAnalyticalValue(101, 1.5);
    expect(value.available).toBe(false);
    expect(value.ev).toBeNull();
    expect(value.reason).toBe('INVALID_PROBABILITY');
  });
});
