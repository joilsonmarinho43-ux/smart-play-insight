import { ShieldAlert, ShieldCheck } from "lucide-react";

interface Props {
  active: boolean;
  onToggle: () => void;
}

export default function KillSwitch({ active, onToggle }: Props) {
  return (
    <button
      onClick={onToggle}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-bold uppercase tracking-wider transition ${
        active
          ? "bg-red-500/15 border-red-500/40 text-red-400 hover:bg-red-500/25"
          : "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20"
      }`}
    >
      {active ? <ShieldAlert className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
      {active ? "Automação DESATIVADA" : "Automação ATIVA"}
    </button>
  );
}
