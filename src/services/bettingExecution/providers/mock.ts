import type {
  AccountBalance,
  BetOrderRequest,
  BetOrderResult,
  BettingProvider,
  MarketQuote,
} from "../types";

/**
 * Provider de simulação. NUNCA envia ordem real.
 * Serve para validar todo o fluxo (guardas, logs, UI) sem risco.
 */
export const MockProvider: BettingProvider = {
  id: "mock",
  label: "Simulador (Nexus33)",
  supportsRealOrders: false,

  async isConfigured() {
    return true;
  },

  async getBalance(): Promise<AccountBalance> {
    return { available: 1000, exposure: 0, currency: "BRL" };
  },

  async getMarketQuote(req: BetOrderRequest): Promise<MarketQuote> {
    return {
      marketId: `sim-${req.market}`,
      selectionId: `sim-${req.selection}`,
      odd: req.requestedOdd,
      open: true,
    };
  },

  async placeOrder(req: BetOrderRequest): Promise<BetOrderResult> {
    return {
      status: "simulated",
      orderId: null,
      executedOdd: req.requestedOdd,
      matchedStake: req.stake,
      message: "SIMULAÇÃO — ORDEM NÃO ENVIADA",
    };
  },

  async getOrderStatus(): Promise<BetOrderResult> {
    return {
      status: "simulated",
      orderId: null,
      message: "SIMULAÇÃO — nenhuma ordem real para consultar",
    };
  },
};
