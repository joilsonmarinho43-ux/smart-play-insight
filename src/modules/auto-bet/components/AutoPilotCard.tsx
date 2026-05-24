import { useState } from "react";
import { ExternalLink, Clock, Zap, Ban } from "lucide-react";
import type { AutoPilotSignal, AutoPilotLog } from "../types";
import type { AutoPilotSettings } from "../config";
import { buildDeepLink } from "../deeplink/superbet";

interface Props {
  signal: AutoPilotSignal;
  settings: AutoPilotSettings;
  onLog: (entry: AutoPilotLog) => void;
}

function evaluate(signal: AutoPilotSignal, s: AutoPilotSettings): { ok: boolean; reason?: string } {
  if (s.killSwitch) return { ok: false, reason: "Kill switch ativo" };
  if (signal.confidence < s.scoreMin) return { ok: false, reason: `Score ${signal.confidence} < mínimo ${s.scoreMin}` };
  if (signal.odd != null) {
    if (signal.odd < s.oddMin) return { ok: false, reason: `Odd ${signal.odd} < mínima ${s.oddMin}` };
    if (signal.odd > s.oddMax) return { ok: false, reason: `Odd ${signal.odd} > máxima ${s.oddMax}` };
  }
  if (s.allowedMarkets.length > 0) {
    const m = signal.market.toLowerCase();
    const allowed = s.allowedMarkets.some((a) => m.includes(a.toLowerCase().split(" ")[0]));
    if (!allowed) return { ok: false, reason: "Mercado fora da whitelist" };
  }
  return { ok: true };
}

export default function AutoPilotCard({ signal, settings, onLog }: Props) {
  const [opened, setOpened] = useState(false);
  const verdict = evaluate(signal, settings);

  const handleOpen = () => {
    const url = buildDeepLink({ house: settings.house, matchName: signal.match_name, market: signal.market });
    window.open(url, "_blank", "noopener,noreferrer");
    setOpened(true);
    onLog({
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      match_name: signal.match_name,
      market: signal.market,
      stake: settings.stake,
      odd: signal.odd,
      score: signal.confidence,
      status: "opened",
    });
  };

  const handleSkip = () => {
    onLog({
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      match_name: signal.match_name,
      market: signal.market,
      stake: settings.stake,
      odd: signal.odd,
      score: signal.confidence,
      status: "skipped",
    });
    setOpened(true);
  };

  return (
    <div className="bg-black/40 border border-white/10 rounded-xl p-3 sm:p-4 hover:border-orange-500/30 transition-colors">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <p className="text-xs text-gray-500 truncate">{signal.league ?? "—"}</p>
          <h3 className="font-bold text-white text-sm sm:text-base truncate">{signal.match_name}</h3>
        </div>
        <div className="flex items-center gap-1 text-xs text-gray-400 shrink-0">
          <Clock className="w-3 h-3" />
          <span>{signal.minute}'</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="px-2 py-1 rounded-md bg-orange-500/10 text-orange-400 text-xs font-bold uppercase">
          {signal.market}
        </span>
        <span className="px-2 py-1 rounded-md bg-white/5 text-gray-300 text-xs">
          Score {signal.confidence}
        </span>
        {signal.odd != null && (
          <span className="px-2 py-1 rounded-md bg-white/5 text-gray-300 text-xs">
            Odd {Number(signal.odd).toFixed(2)}
          </span>
        )}
      </div>

      {!verdict.ok ? (
        <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2">
          <Ban className="w-3.5 h-3.5 shrink-0" />
          <span>Bloqueado: {verdict.reason}</span>
        </div>
      ) : opened ? (
        <p className="text-xs text-emerald-400">✓ Registrado no histórico</p>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={handleOpen}
            className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-orange-500 to-amber-500 text-black font-bold text-sm py-2 px-3 rounded-lg hover:brightness-110 transition"
          >
            <Zap className="w-4 h-4" />
            Abrir na Superbet
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleSkip}
            className="px-3 py-2 text-xs text-gray-400 border border-white/10 rounded-lg hover:bg-white/5"
          >
            Pular
          </button>
        </div>
      )}
    </div>
  );
}
