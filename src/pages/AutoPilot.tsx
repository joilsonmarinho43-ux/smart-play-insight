import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { ArrowLeft, Crosshair, History, Loader2 } from "lucide-react";
import bgPattern from "@/assets/bg-circuit-pattern.jpg";
import { AUTO_BET_ENABLED } from "@/modules/auto-bet/config";
import { useAutoPilotSettings } from "@/modules/auto-bet/hooks/useAutoPilotSettings";
import { useAutoPilotSignals } from "@/modules/auto-bet/hooks/useAutoPilotSignals";
import AutoPilotCard from "@/modules/auto-bet/components/AutoPilotCard";
import AutoPilotSettingsPanel from "@/modules/auto-bet/components/AutoPilotSettings";
import KillSwitch from "@/modules/auto-bet/components/KillSwitch";
import type { AutoPilotLog } from "@/modules/auto-bet/types";

const LOG_KEY = "autopilot.logs.v1";

export default function AutoPilot() {
  if (!AUTO_BET_ENABLED) return <Navigate to="/" replace />;

  const { settings, update, reset, toggleKillSwitch } = useAutoPilotSettings();
  const { data: signals = [], isLoading } = useAutoPilotSignals(30);

  const [logs, setLogs] = useState<AutoPilotLog[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(LOG_KEY) ?? "[]");
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(LOG_KEY, JSON.stringify(logs.slice(0, 200)));
  }, [logs]);

  const addLog = (entry: AutoPilotLog) => setLogs((p) => [entry, ...p]);

  return (
    <div className="min-h-screen text-white pb-12 font-sans relative">
      <div className="fixed inset-0 z-0" style={{ backgroundImage: `url(${bgPattern})`, backgroundSize: "cover" }} />
      <div className="fixed inset-0 z-0 bg-black/60" />

      <main className="container max-w-5xl mx-auto px-4 relative z-10 pt-4 space-y-4">
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link to="/" className="p-2 bg-black/40 rounded-lg hover:bg-black/60 shrink-0">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <Crosshair className="w-6 h-6 text-orange-500 shrink-0" />
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-black uppercase tracking-wider truncate">
                🔥 AutoPilot LIVE
              </h1>
              <p className="text-[10px] text-gray-400 uppercase tracking-widest">
                Modo Semi-Auto · Superbet
              </p>
            </div>
          </div>
          <KillSwitch active={settings.killSwitch} onToggle={toggleKillSwitch} />
        </header>

        <AutoPilotSettingsPanel settings={settings} update={update} reset={reset} />

        <section>
          <h2 className="text-xs uppercase tracking-widest text-gray-400 mb-2">
            Sinais elegíveis (últimos 30 min)
          </h2>
          {isLoading ? (
            <div className="flex items-center gap-2 text-gray-400 text-sm py-6">
              <Loader2 className="w-4 h-4 animate-spin" /> Carregando sinais...
            </div>
          ) : signals.length === 0 ? (
            <p className="text-sm text-gray-500 py-6 text-center bg-black/20 rounded-xl border border-white/5">
              Nenhum sinal nos últimos 30 minutos.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {signals.map((s) => (
                <AutoPilotCard key={s.id} signal={s} settings={settings} onLog={addLog} />
              ))}
            </div>
          )}
        </section>

        <section className="bg-black/30 border border-white/10 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <History className="w-4 h-4 text-orange-500" />
            <h2 className="text-sm font-bold uppercase tracking-wider">Histórico AutoPilot</h2>
          </div>
          {logs.length === 0 ? (
            <p className="text-xs text-gray-500">Nenhuma ação registrada ainda.</p>
          ) : (
            <div className="space-y-1.5 max-h-80 overflow-auto">
              {logs.map((l) => (
                <div key={l.id} className="flex items-center justify-between gap-2 text-xs text-gray-300 border-b border-white/5 py-1.5">
                  <div className="truncate">
                    <span className="text-gray-500">{new Date(l.ts).toLocaleTimeString("pt-BR")}</span>{" "}
                    <span className="text-white font-bold">{l.match_name}</span>{" "}
                    · {l.market} · Score {l.score}
                    {l.odd != null && ` · Odd ${Number(l.odd).toFixed(2)}`}
                    {" · "} R$ {l.stake}
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase shrink-0 ${
                      l.status === "opened"
                        ? "bg-emerald-500/15 text-emerald-400"
                        : l.status === "skipped"
                        ? "bg-gray-500/15 text-gray-400"
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

        <p className="text-[10px] text-gray-500 text-center pt-2">
          Módulo isolado · Feature flag <code className="text-orange-400">AUTO_BET_ENABLED</code> · Não interfere em scanner, IA, alertas ou banca.
        </p>
      </main>
    </div>
  );
}
