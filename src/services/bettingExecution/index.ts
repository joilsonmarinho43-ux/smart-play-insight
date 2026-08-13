import { LaybackProvider } from "./providers/layback";
import { MockProvider } from "./providers/mock";
import { loadLogs, saveLog } from "./settings";
import type {
  BetOrderRequest,
  BettingProvider,
  ExecutionLog,
  ExecutionSettings,
  ProviderId,
} from "./types";

export * from "./types";
export { useExecutionSettings, DEFAULT_SETTINGS, loadLogs, clearLogs } from "./settings";

const PROVIDERS: Record<ProviderId, BettingProvider> = {
  mock: MockProvider,
  layback: LaybackProvider,
};

export function getProvider(id: ProviderId): BettingProvider {
  return PROVIDERS[id] ?? MockProvider;
}

export function listProviders(): BettingProvider[] {
  return Object.values(PROVIDERS);
}

function todayLogs(): ExecutionLog[] {
  const day = new Date().toISOString().slice(0, 10);
  return loadLogs().filter((l) => l.ts.slice(0, 10) === day);
}

function blocked(req: BetOrderRequest, settings: ExecutionSettings, message: string): ExecutionLog {
  return saveLog({
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    signalId: req.signalId,
    matchName: req.matchName,
    market: req.market,
    selection: req.selection,
    requestedOdd: req.requestedOdd,
    executedOdd: null,
    stake: req.stake,
    provider: settings.provider,
    mode: settings.mode,
    orderId: null,
    status: "blocked",
    message,
  })[0];
}

/**
 * Fluxo completo com todas as proteções.
 * Em modo "simulation" o provider nunca envia ordem real.
 */
export async function executeSignal(
  req: BetOrderRequest,
  settings: ExecutionSettings,
): Promise<ExecutionLog> {
  const provider = getProvider(settings.provider);

  if (settings.killSwitch) return blocked(req, settings, "STOP BOT ativo");
  if (!settings.enabled) return blocked(req, settings, "Execução automática desativada");
  if (req.stake <= 0 || req.stake > settings.stakeMax)
    return blocked(req, settings, `Stake fora do limite (máx R$ ${settings.stakeMax})`);
  if (req.requestedOdd < settings.oddMin || req.requestedOdd > settings.oddMax)
    return blocked(
      req,
      settings,
      `Odd ${req.requestedOdd.toFixed(2)} fora da faixa ${settings.oddMin}–${settings.oddMax}`,
    );
  if (!req.market || !req.selection) return blocked(req, settings, "Mercado/seleção inválidos");

  const today = todayLogs();
  if (today.some((l) => l.signalId === req.signalId && l.status !== "blocked"))
    return blocked(req, settings, "Entrada duplicada para o mesmo sinal");

  const executed = today.filter((l) => l.status === "placed" || l.status === "simulated");
  if (executed.length >= settings.maxEntriesPerDay)
    return blocked(req, settings, `Limite diário de ${settings.maxEntriesPerDay} entradas atingido`);

  const exposure = executed.reduce((s, l) => s + l.stake, 0);
  if (exposure + req.stake > settings.exposureMax)
    return blocked(req, settings, `Exposição máxima de R$ ${settings.exposureMax} atingida`);
  if (exposure >= settings.stopLossDaily)
    return blocked(req, settings, `Stop-loss diário de R$ ${settings.stopLossDaily} atingido`);

  if (settings.mode === "live") {
    if (!provider.supportsRealOrders)
      return blocked(req, settings, `${provider.label} não suporta ordens reais ainda`);
    if (!(await provider.isConfigured()))
      return blocked(req, settings, `${provider.label} não está credenciado/configurado`);

    const balance = await provider.getBalance();
    if (!balance || balance.available < req.stake)
      return blocked(req, settings, "Saldo insuficiente na casa");

    const quote = await provider.getMarketQuote(req);
    if (!quote || !quote.open) return blocked(req, settings, "Mercado fechado ou indisponível");
  }

  const result =
    settings.mode === "simulation"
      ? await MockProvider.placeOrder(req)
      : await provider.placeOrder(req);

  return saveLog({
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    signalId: req.signalId,
    matchName: req.matchName,
    market: req.market,
    selection: req.selection,
    requestedOdd: req.requestedOdd,
    executedOdd: result.executedOdd ?? null,
    stake: req.stake,
    provider: settings.provider,
    mode: settings.mode,
    orderId: result.orderId ?? null,
    status: result.status,
    message: result.message,
  })[0];
}
