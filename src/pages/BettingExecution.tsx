import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Banknote, History, Loader2, Power, ShieldAlert } from "lucide-react";
import bgPattern from "@/assets/bg-circuit-pattern.jpg";
import {
  DEFAULT_SETTINGS,
  clearLogs,
  executeSignal,
  listProviders,
  loadLogs,
  useExecutionSettings,
  type ExecutionLog,
  type ProviderId,
} from "@/services/bettingExecution";

const NUMERIC_FIELDS: { key: keyof typeof DEFAULT_SETTINGS; label: string; step: number }[] = [
  { key: "stakeDefault", label: "Stake padrão (R$)", step: 1 },
  { key: "stakeMax", label: "Stake máxima (R$)", step: 1 },
  { key: "exposureMax", label: "Exposição máxima (R$)", step: 5 },
  { key: "oddMin", label: "Odd mínima", step: 0.01 },
  { key: "oddMax", label: "Odd máxima", step: 0.01 },
  { key: "maxEntriesPerDay", label: "Máx. entradas/dia", step: 1 },
  { key: "stopLossDaily", label: "Stop-loss diário (R$)", step: 5 },
];

export default function BettingExecution() {
  const { settings, update, reset, toggleKillSwitch } = useExecutionSettings();
  const [logs, setLogs] = useState<ExecutionLog[]>(() => loadLogs());
  const [busy, setBusy] = useState(false);

  const runTest = async () => {
    setBusy(true);
    await executeSignal(
      {
        signalId: `test-${Date.now()}`,
        matchName: "Brasil x Alemanha",
        market: "Over 0.5 HT",
        selection: "Sim",
        requestedOdd: 1.42,
        stake: settings.stakeDefault,
      },
      settings,
    );
    setLogs(loadLogs());
    setBusy(false);
  };

  return (
    <div className="min-h-screen text-white pb-12 font-sans relative">
      <div className="fixed inset-0 z-0" style={{ backgroundImage: `url(${bgPattern})`, backgroundSize: "cover" }} />
      <div className="fixed inset-0 z-0 bg-black/70" />

      <main className="container max-w-5xl mx-auto px-4 relative z-10 pt-4 space-y-4">
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link to="/" className="p-2 bg-black/40 rounded-lg hover:bg-black/60 shrink-0">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <Banknote className="w-6 h-6 text-orange-500 shrink-0" />
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-black uppercase tracking-wider truncate">
                Execução de Apostas
              </h1>
              <p className="text-[10px] text-gray-400 uppercase tracking-widest">
                Módulo isolado · Modo simulação
              </p>
            </div>
          </div>
          <button
            onClick={toggleKillSwitch}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-black uppercase border transition-colors ${
              settings.killSwitch
                ? "bg-red-500/20 border-red-500/50 text-red-400"
                : "bg-black/40 border-white/10 text-gray-300 hover:text-white"
            }`}
          >
            <Power className="w-4 h-4" /> Stop Bot
          </button>
        </header>

        <section className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex gap-3">
          <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-100/90 leading-relaxed">
            Não há API pública oficial documentada da Bolsa de Aposta / Layback para envio de ordens.
            Enquanto não houver credenciamento oficial, apenas o <strong>modo simulação</strong> fica
            disponível. Credenciais, quando existirem, ficarão exclusivamente no backend.
          </p>
        </section>

        <section className="bg-black/40 border border-white/10 rounded-xl p-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center justify-between gap-3 bg-black/30 border border-white/5 rounded-lg px-3 py-2.5">
              <span className="text-xs uppercase tracking-wider text-gray-300">Execução automática</span>
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(e) => update("enabled", e.target.checked)}
                className="h-4 w-4 accent-orange-500"
              />
            </label>

            <label className="flex items-center justify-between gap-3 bg-black/30 border border-white/5 rounded-lg px-3 py-2.5">
              <span className="text-xs uppercase tracking-wider text-gray-300">Modo</span>
              <select
                value={settings.mode}
                onChange={(e) => update("mode", e.target.value as "simulation" | "live")}
                className="bg-black/60 border border-white/10 rounded px-2 py-1 text-xs"
              >
                <option value="simulation">Simulação</option>
                <option value="live">Real (bloqueado)</option>
              </select>
            </label>

            <label className="flex items-center justify-between gap-3 bg-black/30 border border-white/5 rounded-lg px-3 py-2.5 sm:col-span-2">
              <span className="text-xs uppercase tracking-wider text-gray-300">Plataforma</span>
              <select
                value={settings.provider}
                onChange={(e) => update("provider", e.target.value as ProviderId)}
                className="bg-black/60 border border-white/10 rounded px-2 py-1 text-xs"
              >
                {listProviders().map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>

            {NUMERIC_FIELDS.map((f) => (
              <label key={f.key} className="flex items-center justify-between gap-3 bg-black/30 border border-white/5 rounded-lg px-3 py-2.5">
                <span className="text-xs uppercase tracking-wider text-gray-300">{f.label}</span>
                <input
                  type="number"
                  step={f.step}
                  value={settings[f.key] as number}
                  onChange={(e) => update(f.key as never, Number(e.target.value) as never)}
                  className="w-24 bg-black/60 border border-white/10 rounded px-2 py-1 text-xs text-right"
                />
              </label>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={runTest}
              disabled={busy}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500/15 border border-orange-500/40 text-orange-400 text-xs font-black uppercase hover:bg-orange-500/25 disabled:opacity-50"
            >
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Testar sinal (simulação)
            </button>
            <button
              onClick={reset}
              className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-xs font-bold uppercase text-gray-300 hover:text-white"
            >
              Restaurar padrões
            </button>
            <button
              onClick={() => {
                clearLogs();
                setLogs([]);
              }}
              className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-xs font-bold uppercase text-gray-300 hover:text-white"
            >
              Limpar logs
            </button>
          </div>
        </section>

        <section className="bg-black/30 border border-white/10 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <History className="w-4 h-4 text-orange-500" />
            <h2 className="text-sm font-bold uppercase tracking-wider">Logs de execução</h2>
          </div>
          {logs.length === 0 ? (
            <p className="text-xs text-gray-500">Nenhuma tentativa registrada ainda.</p>
          ) : (
            <div className="space-y-1.5 max-h-96 overflow-auto">
              {logs.map((l) => (
                <div key={l.id} className="flex items-start justify-between gap-2 text-xs text-gray-300 border-b border-white/5 py-1.5">
                  <div className="min-w-0">
                    <span className="text-gray-500">{new Date(l.ts).toLocaleTimeString("pt-BR")}</span>{" "}
                    <span className="text-white font-bold">{l.matchName}</span> · {l.market} ·{" "}
                    {l.selection} · Odd {l.requestedOdd.toFixed(2)}
                    {l.executedOdd != null && ` → ${l.executedOdd.toFixed(2)}`} · R$ {l.stake.toFixed(2)}
                    <div className="text-[10px] text-gray-500 truncate">
                      {l.provider} · {l.mode} · {l.orderId ?? "sem ID"} · {l.message}
                    </div>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase shrink-0 ${
                      l.status === "placed"
                        ? "bg-emerald-500/15 text-emerald-400"
                        : l.status === "simulated"
                        ? "bg-sky-500/15 text-sky-400"
                        : "bg-red-500/15 text-red-400"
                    }`}
                  >
                    {l.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
