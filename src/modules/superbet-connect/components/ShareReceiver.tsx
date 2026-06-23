import { useState } from 'react';
import { useShareTarget, type SharedPayload } from '../hooks/useShareTarget';
import { Inbox } from 'lucide-react';

interface Props {
  onPayload: (payload: SharedPayload) => void;
}

export function ShareReceiver({ onPayload }: Props) {
  const [last, setLast] = useState<SharedPayload | null>(null);
  useShareTarget((p) => {
    setLast(p);
    onPayload(p);
  });

  return (
    <div className="rounded-lg border border-dashed border-amber-500/30 bg-amber-500/5 p-4 text-center">
      <Inbox className="mx-auto h-6 w-6 text-amber-400" />
      <p className="mt-2 text-sm text-amber-100">
        Aguardando compartilhamento da Superbet
      </p>
      <p className="mt-1 text-xs text-amber-100/70">
        No app Android, toque em <b>Compartilhar</b> dentro da Superbet e escolha <b>Analista Joilson</b>.
      </p>
      {last && (
        <p className="mt-3 text-[11px] text-amber-200/80 break-all">
          Último recebido: {last.url ?? last.text?.slice(0, 80)}…
        </p>
      )}
    </div>
  );
}
