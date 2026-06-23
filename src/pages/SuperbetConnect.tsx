import { useState } from 'react';
import { Smartphone, CircleDot, ShieldCheck, Hand } from 'lucide-react';
import { ManualPaste } from '@/modules/superbet-connect/components/ManualPaste';
import { OverlayControl } from '@/modules/superbet-connect/components/OverlayControl';
import { SuperbetConnectCard } from '@/modules/superbet-connect/components/SuperbetConnectCard';
import { useCaptureStore } from '@/modules/superbet-connect/hooks/useCaptureStore';
import { SUPERBET_CONNECT_ENABLED, PARSER_VERSION } from '@/modules/superbet-connect/config';

export default function SuperbetConnect() {
  const { captures, loading, submit, remove } = useCaptureStore();
  const [busy, setBusy] = useState(false);

  if (!SUPERBET_CONNECT_ENABLED) {
    return <div className="p-6 text-white/70">Módulo desativado.</div>;
  }

  const handleSubmit = async (input: { rawText?: string; sourceUrl?: string; imageBase64?: string }) => {
    setBusy(true);
    try { return await submit(input); }
    finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 pb-24">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <Smartphone className="h-6 w-6 text-amber-400" />
          <h1 className="text-2xl font-bold text-white">Superbet Connect</h1>
          <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] uppercase text-amber-300">
            Beta · {PARSER_VERSION}
          </span>
        </div>
        <p className="text-sm text-white/70">
          Capture dados ao vivo da Superbet usando uma bolha flutuante sobre o app — sem login,
          sem API, sem precisar do botão Compartilhar.
        </p>
      </header>

      <section className="rounded-xl border border-white/10 bg-gradient-to-br from-amber-500/5 to-black/40 p-4">
        <h2 className="mb-3 text-sm font-semibold text-amber-300">Como funciona</h2>
        <ol className="space-y-2 text-sm text-white/80">
          <li className="flex gap-2"><CircleDot className="h-4 w-4 shrink-0 text-amber-400" /> Ative a bolha (abaixo) e conceda as 2 permissões</li>
          <li className="flex gap-2"><Hand className="h-4 w-4 shrink-0 text-amber-400" /> Abra a Superbet, navegue até o jogo e toque na bolha laranja</li>
          <li className="flex gap-2"><ShieldCheck className="h-4 w-4 shrink-0 text-amber-400" /> Os dados ficam só na sua conta — OCR é processado no seu app + servidor seguro</li>
        </ol>
      </section>

      <OverlayControl />

      <details className="rounded-xl border border-white/10 bg-black/30 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-white/80">
          Não estou no Android? Colar texto / imagem manualmente
        </summary>
        <div className="mt-4">
          <ManualPaste onSubmit={handleSubmit} busy={busy} />
        </div>
      </details>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-white">Últimas capturas</h2>
        {loading ? (
          <p className="text-xs text-white/50">Carregando...</p>
        ) : captures.length === 0 ? (
          <p className="text-xs text-white/50">Nenhuma captura ainda.</p>
        ) : (
          <div className="space-y-2">
            {captures.map((c) => (
              <SuperbetConnectCard key={c.id} capture={c} onRemove={remove} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
