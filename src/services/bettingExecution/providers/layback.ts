import type {
  AccountBalance,
  BetOrderRequest,
  BetOrderResult,
  BettingProvider,
  MarketQuote,
} from "../types";

/**
 * LaybackProvider — PLACEHOLDER OFICIALMENTE VAZIO.
 *
 * Nenhum endpoint, token ou método de autenticação foi inventado aqui.
 * Enquanto a Bolsa de Aposta / Layback não fornecer documentação oficial
 * (API de parceiro + credenciamento), este provider recusa qualquer ordem.
 *
 * Quando houver documentação oficial, a implementação deve viver em uma
 * Edge Function (backend), NUNCA no frontend, pois exigirá credenciais.
 */
const NOT_AVAILABLE =
  "Integração Layback/Bolsa de Aposta indisponível: nenhuma API oficial de execução de apostas foi documentada/autorizada até o momento.";

export const LaybackProvider: BettingProvider = {
  id: "layback",
  label: "Bolsa de Aposta / Layback (aguardando API oficial)",
  supportsRealOrders: false,

  async isConfigured() {
    return false;
  },

  async getBalance(): Promise<AccountBalance | null> {
    return null;
  },

  async getMarketQuote(_req: BetOrderRequest): Promise<MarketQuote | null> {
    return null;
  },

  async placeOrder(_req: BetOrderRequest): Promise<BetOrderResult> {
    return { status: "rejected", message: NOT_AVAILABLE };
  },

  async getOrderStatus(_orderId: string): Promise<BetOrderResult> {
    return { status: "rejected", message: NOT_AVAILABLE };
  },
};
