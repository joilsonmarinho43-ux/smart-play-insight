import { useState } from 'react';
import { Smartphone, Share2, ShieldCheck, Wifi } from 'lucide-react';
import { ManualPaste } from '@/modules/superbet-connect/components/ManualPaste';
import { ShareReceiver } from '@/modules/superbet-connect/components/ShareReceiver';
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
          Envie dados da Superbet para enriquecer a análise. Funciona compartilhando texto, URL ou
          screenshot do app Superbet para o Analista Joilson.
        </p>
      </header>

      {/* Como funciona */}
      <section className="rounded-xl border border-white/10 bg-gradient-to-br from-amber-500/5 to-black/40 p-4">
        <h2 className="mb-3 text-sm font-semibold text-amber-300">Como usar</h2>
        <ol className="space-y-2 text-sm text-white/80">
          <li className="flex gap-2"><Share2 className="h-4 w-4 shrink-0 text-amber-400" /> Abra o jogo dentro do app Superbet</li>
          <li className="flex gap-2"><Share2 className="h-4 w-4 shrink-0 text-amber-400" /> Toque em <b>Compartilhar</b> e escolha <b>Analista Joilson</b></li>
          <li className="flex gap-2"><ShieldCheck className="h-4 w-4 shrink-0 text-amber-400" /> Seus dados ficam só na sua conta — nada é compartilhado com terceiros</li>
          <li className="flex gap-2"><Wifi className="h-4 w-4 shrink-0 text-amber-400" /> No navegador você pode colar texto manualmente (abaixo)</li>
        </ol>
        <p className="mt-3 text-[11px] text-white/50">
          Para compartilhamento direto da Superbet, é necessário instalar a versão Android do Analista Joilson (Capacitor).
        </p>
      </section>

      <ShareReceiver
        onPayload={(p) => {
          void handleSubmit({ rawText: p.text, sourceUrl: p.url, imageBase64: p.image });
        }}
      />

      <ManualPaste onSubmit={handleSubmit} busy={busy} />

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
