import { Badge } from '@/components/ui/badge';
import { CheckCircle2, AlertCircle, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SuperbetCaptureRow } from '../types';

interface Props {
  capture: SuperbetCaptureRow;
  onRemove: (id: string) => void;
}

const STATUS_MAP: Record<string, { icon: typeof CheckCircle2; color: string; label: string }> = {
  parsed:  { icon: CheckCircle2, color: 'text-emerald-400', label: 'Analisado' },
  pending: { icon: Loader2,      color: 'text-amber-400 animate-spin', label: 'Processando' },
  parsing: { icon: Loader2,      color: 'text-amber-400 animate-spin', label: 'Processando' },
  failed:  { icon: AlertCircle,  color: 'text-red-400',    label: 'Falhou' },
};

export function SuperbetConnectCard({ capture, onRemove }: Props) {
  const s = STATUS_MAP[capture.status] ?? STATUS_MAP.pending;
  const Icon = s.icon;
  const preview =
    capture.source_url ||
    capture.raw_text?.slice(0, 120) ||
    (capture.raw_image_url ? '📷 imagem' : '—');

  return (
    <div className="flex items-start gap-3 rounded-lg border border-white/10 bg-black/40 p-3">
      <Icon className={`h-5 w-5 shrink-0 ${s.color}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] uppercase">{s.label}</Badge>
          {capture.confidence != null && (
            <span className="text-[10px] text-white/60">
              confiança {(capture.confidence * 100).toFixed(0)}%
            </span>
          )}
          {capture.parser_version && (
            <span className="text-[10px] text-white/40">{capture.parser_version}</span>
          )}
        </div>
        <p className="mt-1 truncate text-xs text-white/80">{preview}</p>
        <p className="mt-0.5 text-[10px] text-white/40">
          {new Date(capture.created_at).toLocaleString('pt-BR')}
        </p>
      </div>
      <Button variant="ghost" size="icon" onClick={() => onRemove(capture.id)}>
        <Trash2 className="h-4 w-4 text-white/50" />
      </Button>
    </div>
  );
}
