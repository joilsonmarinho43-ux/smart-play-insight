import { Link } from 'react-router-dom';
import { ArrowLeft, ShieldAlert } from 'lucide-react';

export default function Scanner() {
  return (
    <main className="min-h-screen bg-background p-4 sm:p-6">
      <div className="mx-auto max-w-3xl">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-primary">
          <ArrowLeft className="h-4 w-4" /> Voltar ao pré-jogo
        </Link>
        <section className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6">
          <div className="flex items-center gap-3">
            <ShieldAlert className="h-6 w-6 text-amber-400" />
            <div>
              <h1 className="text-xl font-black">SCANNER PRO</h1>
              <p className="text-xs text-muted-foreground">Módulo de sinais do NEXUS Core</p>
            </div>
          </div>
          <div className="mt-5 rounded-xl border border-white/10 bg-black/20 p-4">
            <p className="text-sm font-semibold text-amber-300">Sinais temporariamente bloqueados</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              O Scanner só libera um sinal operacional quando existe odd real observada,
              probabilidade do modelo validada, EV positivo e aprovação do NEXUS Core.
              Sem esses requisitos, o resultado correto é não emitir sinal.
            </p>
            <div className="mt-4 grid gap-2 text-[11px] text-gray-400 sm:grid-cols-2">
              <div>✓ Probabilidade: MODEL_ESTIMATE</div>
              <div>✓ Calibração: VALIDATED/CALIBRATED</div>
              <div>✓ Odd: OBSERVED</div>
              <div>✓ EV: positivo</div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
