// 🔒 Módulo isolado de execução de apostas (Betting Execution)
// Nenhuma credencial trafega ou é armazenada no frontend.

export type ExecutionMode = "simulation" | "live";

export type ProviderId = "mock" | "layback";

export interface BetOrderRequest {
  /** Identificador único do sinal — usado para deduplicação */
  signalId: string;
  matchId?: string | null;
  matchName: string;
  league?: string | null;
  /** Ex.: "Over 0.5 HT", "Over 1.5 FT" */
  market: string;
  /** Seleção dentro do mercado. Ex.: "Sim", "Casa", "Over" */
  selection: string;
  /** Odd solicitada pelo sinal */
  requestedOdd: number;
  /** Stake em R$ */
  stake: number;
}

export interface BetOrderResult {
  status: "simulated" | "placed" | "rejected" | "error";
  orderId?: string | null;
  /** Odd realmente executada pela casa (quando disponível) */
  executedOdd?: number | null;
  matchedStake?: number | null;
  message: string;
}

export interface AccountBalance {
  available: number;
  exposure: number;
  currency: string;
}

export interface MarketQuote {
  marketId: string;
  selectionId: string;
  odd: number;
  open: boolean;
}

/** Contrato que qualquer casa/exchange precisa implementar */
export interface BettingProvider {
  readonly id: ProviderId;
  readonly label: string;
  /** false enquanto não houver integração oficial comprovada */
  readonly supportsRealOrders: boolean;
  isConfigured(): Promise<boolean>;
  getBalance(): Promise<AccountBalance | null>;
  getMarketQuote(req: BetOrderRequest): Promise<MarketQuote | null>;
  placeOrder(req: BetOrderRequest): Promise<BetOrderResult>;
  getOrderStatus(orderId: string): Promise<BetOrderResult>;
}

export interface ExecutionSettings {
  enabled: boolean;
  mode: ExecutionMode;
  provider: ProviderId;
  stakeDefault: number;
  stakeMax: number;
  exposureMax: number;
  oddMin: number;
  oddMax: number;
  maxEntriesPerDay: number;
  stopLossDaily: number;
  killSwitch: boolean;
}

export interface ExecutionLog {
  id: string;
  ts: string;
  signalId: string;
  matchName: string;
  market: string;
  selection: string;
  requestedOdd: number;
  executedOdd: number | null;
  stake: number;
  provider: ProviderId;
  mode: ExecutionMode;
  orderId: string | null;
  status: BetOrderResult["status"] | "blocked";
  message: string;
}
