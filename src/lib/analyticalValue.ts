import type { MarketAnalysis } from '@/types/match';

/**
 * Valor analítico com preço real.
 *
 * EV só existe quando temos uma odd observada de uma fonte de mercado.
 * Baselines médios, odds típicas, odds justas e odds derivadas da própria
 * probabilidade NÃO são preços observados e, portanto, não geram EV.
 */
export interface AnalyticalValue {
  available: boolean;
  ev: number | null;
  fairOdd: number | null;
  marketOdd: number | null;
  reason: 'REAL_MARKET_ODD' | 'MARKET_ODD_MISSING' | 'INVALID_PROBABILITY' | 'INVALID_ODD';
}

export function calculateAnalyticalValue(
  probability: number,
  marketOdd?: number | null,
): AnalyticalValue {
  if (!Number.isFinite(probability) || probability <= 0 || probability > 100) {
    return { available: false, ev: null, fairOdd: null, marketOdd: null, reason: 'INVALID_PROBABILITY' };
  }

  const fairOdd = 100 / probability;

  if (marketOdd == null) {
    return { available: false, ev: null, fairOdd, marketOdd: null, reason: 'MARKET_ODD_MISSING' };
  }

  if (!Number.isFinite(marketOdd) || marketOdd <= 1) {
    return { available: false, ev: null, fairOdd, marketOdd: null, reason: 'INVALID_ODD' };
  }

  const p = probability / 100;
  const ev = p * marketOdd - 1;
  return {
    available: true,
    ev: Math.round(ev * 1000) / 1000,
    fairOdd: Math.round(fairOdd * 100) / 100,
    marketOdd: Math.round(marketOdd * 100) / 100,
    reason: 'REAL_MARKET_ODD',
  };
}

/**
 * Calcula valor somente usando a odd explicitamente presente no mercado.
 * Nunca cria uma odd sintética a partir da probabilidade.
 */
export function calculateMarketAnalyticalValue(market: MarketAnalysis): AnalyticalValue {
  return calculateAnalyticalValue(market.probability, market.odd);
}
