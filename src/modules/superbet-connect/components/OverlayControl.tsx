import { useCallback } from 'react';
import { CircleDot, ShieldAlert, Power, Camera, MonitorSmartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useOverlay } from '../hooks/useOverlay';
import { useCaptureStore } from '../hooks/useCaptureStore';
import { toast } from 'sonner';

export function OverlayControl() {
  const { submit } = useCaptureStore();

  const handleCapture = useCallback(async (p: { imageBase64: string }) => {
    toast.loading('Analisando captura da Superbet…', { id: 'sb-cap' });
    const id = await submit({ imageBase64: p.imageBase64 });
    if (id) toast.success('Dados extraídos e enviados pra análise', { id: 'sb-cap' });
    else toast.error('Falha ao processar a captura', { id: 'sb-cap' });
  }, [submit]);

  const ov = useOverlay(handleCapture);

  if (!ov.supported) {
    return (
      <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
        <div className="flex items-center gap-2 text-sm text-white/80">
          <MonitorSmartphone className="h-5 w-5 text-amber-400" />
          <span className="font-semibold">Bolha flutuante</span>
          <span className="ml-auto rounded bg-white/10 px-2 py-0.5 text-[10px] uppercase">
            Android apenas
          </span>
        </div>
        <p className="mt-2 text-xs text-white/60">
          A bolha flutuante captura a tela da Superbet com um toque. Funciona apenas
          no APK Android do Analista Joilson — abra esta tela pelo aplicativo instalado
          no celular pra usar.
        </p>
      </div>
    );
  }

  const s = ov.status;
  const overlayOk = s?.overlayPermission ?? false;
  const projOk = s?.projectionReady ?? false;
  const running = s?.overlayRunning ?? false;

  return (
    <div className="rounded-xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 to-black/40 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <CircleDot className={`h-5 w-5 ${running ? 'text-emerald-400 animate-pulse' : 'text-amber-400'}`} />
        <h3 className="font-semibold text-white">Bolha flutuante Superbet</h3>
        <span className={`ml-auto rounded px-2 py-0.5 text-[10px] uppercase ${
          running ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-white/60'
        }`}>
          {running ? 'Ativa' : 'Inativa'}
        </span>
      </div>

      <ol className="space-y-2 text-sm">
        <li className={`flex items-center gap-2 ${overlayOk ? 'text-emerald-300' : 'text-white/70'}`}>
          <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
            overlayOk ? 'bg-emerald-500/30' : 'bg-white/10'
          }`}>1</span>
          Permissão "Exibir sobre outros apps"
          {!overlayOk && (
            <Button size="sm" variant="outline" className="ml-auto h-7"
              disabled={ov.busy} onClick={() => void ov.requestOverlay()}>
              Conceder
            </Button>
          )}
        </li>
        <li className={`flex items-center gap-2 ${projOk ? 'text-emerald-300' : 'text-white/70'}`}>
          <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
            projOk ? 'bg-emerald-500/30' : 'bg-white/10'
          }`}>2</span>
          Autorização de captura de tela
          {!projOk && (
            <Button size="sm" variant="outline" className="ml-auto h-7"
              disabled={ov.busy || !overlayOk} onClick={() => void ov.requestProjection()}>
              Autorizar
            </Button>
          )}
        </li>
      </ol>

      <div className="flex flex-wrap gap-2">
        {!running ? (
          <Button
            size="sm"
            className="bg-amber-500 text-black hover:bg-amber-400"
            disabled={ov.busy || !overlayOk || !projOk}
            onClick={() => void ov.start()}
          >
            <Power className="mr-1 h-4 w-4" /> Ativar bolha
          </Button>
        ) : (
          <>
            <Button size="sm" variant="destructive" disabled={ov.busy}
              onClick={() => void ov.stop()}>
              <Power className="mr-1 h-4 w-4" /> Desativar
            </Button>
            <Button size="sm" variant="secondary" disabled={ov.busy}
              onClick={() => void ov.captureNow()}>
              <Camera className="mr-1 h-4 w-4" /> Capturar agora
            </Button>
          </>
        )}
      </div>

      <p className="text-[11px] text-white/50">
        Abra a Superbet no jogo desejado e toque na bolha laranja. A tela é capturada,
        processada por OCR e os dados extraídos enriquecem a análise no Analista Joilson.
      </p>

      {ov.lastError && (
        <div className="flex gap-2 rounded border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-200">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span><b>{ov.lastError.code}:</b> {ov.lastError.message}</span>
        </div>
      )}

      {ov.lastCapture && (
        <div className="rounded border border-white/10 bg-black/30 p-2 text-[11px] text-white/70">
          Última captura: {new Date(ov.lastCapture.timestamp).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}
