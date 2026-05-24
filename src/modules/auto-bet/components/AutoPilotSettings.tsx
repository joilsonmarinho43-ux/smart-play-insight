import type { AutoPilotSettings } from "../config";

interface Props {
  settings: AutoPilotSettings;
  update: <K extends keyof AutoPilotSettings>(key: K, value: AutoPilotSettings[K]) => void;
  reset: () => void;
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block">
    <span className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">{label}</span>
    {children}
  </label>
);

const num =
  "w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-orange-500/50 focus:outline-none";

export default function AutoPilotSettingsPanel({ settings, update, reset }: Props) {
  return (
    <div className="bg-black/30 border border-white/10 rounded-xl p-4 space-y-4">
      <h3 className="font-bold text-white text-sm uppercase tracking-wider">⚙️ Configurações</h3>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Field label="Stake (R$)">
          <input type="number" min={1} className={num} value={settings.stake}
            onChange={(e) => update("stake", Number(e.target.value))} />
        </Field>
        <Field label="Odd mínima">
          <input type="number" step={0.05} className={num} value={settings.oddMin}
            onChange={(e) => update("oddMin", Number(e.target.value))} />
        </Field>
        <Field label="Odd máxima">
          <input type="number" step={0.05} className={num} value={settings.oddMax}
            onChange={(e) => update("oddMax", Number(e.target.value))} />
        </Field>
        <Field label="Score mínimo">
          <input type="number" min={0} max={100} className={num} value={settings.scoreMin}
            onChange={(e) => update("scoreMin", Number(e.target.value))} />
        </Field>
        <Field label="Limite diário">
          <input type="number" min={1} className={num} value={settings.dailyLimit}
            onChange={(e) => update("dailyLimit", Number(e.target.value))} />
        </Field>
        <Field label="Stop loss (R$)">
          <input type="number" min={0} className={num} value={settings.stopLoss}
            onChange={(e) => update("stopLoss", Number(e.target.value))} />
        </Field>
        <Field label="Stop win (R$)">
          <input type="number" min={0} className={num} value={settings.stopWin}
            onChange={(e) => update("stopWin", Number(e.target.value))} />
        </Field>
        <Field label="Modo">
          <select className={num} value={settings.mode}
            onChange={(e) => update("mode", e.target.value as AutoPilotSettings["mode"])}>
            <option value="manual">Manual (só alerta)</option>
            <option value="semi">Semi-auto (1 clique)</option>
          </select>
        </Field>
        <Field label="Casa">
          <select className={num} value={settings.house}
            onChange={(e) => update("house", e.target.value as AutoPilotSettings["house"])}>
            <option value="superbet">Superbet</option>
          </select>
        </Field>
      </div>

      <Field label="Mercados permitidos (palavras-chave, separe por vírgula)">
        <input type="text" className={num} value={settings.allowedMarkets.join(", ")}
          onChange={(e) => update("allowedMarkets", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />
      </Field>

      <button onClick={reset} className="text-xs text-gray-400 hover:text-white underline">
        Restaurar padrões
      </button>
    </div>
  );
}
