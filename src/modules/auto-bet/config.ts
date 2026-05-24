// ============================================================
// AutoPilot LIVE — Configuração isolada
// NUNCA importar nada deste módulo em código fora de /modules/auto-bet
// ou /pages/AutoPilot.tsx. Mantém o app principal 100% intacto.
// ============================================================

/**
 * Feature flag mestre. Default OFF.
 * Para ativar em produção, defina VITE_AUTO_BET_ENABLED=true no .env
 * Em dev, pode ativar manualmente no localStorage:
 *   localStorage.setItem('autopilot.flag.override', 'true')
 */
export const AUTO_BET_ENABLED: boolean = (() => {
  const env = (import.meta.env.VITE_AUTO_BET_ENABLED ?? "").toString().toLowerCase() === "true";
  if (env) return true;
  if (typeof window !== "undefined") {
    return localStorage.getItem("autopilot.flag.override") === "true";
  }
  return false;
})();

export const SUPPORTED_HOUSES = [
  { id: "superbet", name: "Superbet", baseUrl: "https://superbet.bet.br" },
] as const;

export type HouseId = (typeof SUPPORTED_HOUSES)[number]["id"];

export const DEFAULT_SETTINGS = {
  house: "superbet" as HouseId,
  mode: "manual" as "manual" | "semi",      // 'auto' fica reservado para futuro
  stake: 10,
  oddMin: 1.4,
  oddMax: 3.5,
  scoreMin: 70,
  dailyLimit: 20,
  stopLoss: 100,
  stopWin: 200,
  allowedMarkets: ["Over 0.5 HT", "Over 1.5 FT", "Over 2.5 FT", "Escanteios"] as string[],
  killSwitch: false,
};

export type AutoPilotSettings = typeof DEFAULT_SETTINGS;
