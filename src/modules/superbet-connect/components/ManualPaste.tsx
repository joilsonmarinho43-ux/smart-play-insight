import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Clipboard, Send, Loader2, ImagePlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { runOcr, fileToBase64 } from '../ocr/runOcr';
import { OCR_MIN_CONFIDENCE } from '../config';

interface Props {
  onSubmit: (input: {
    rawText?: string;
    sourceUrl?: string;
    imageBase64?: string;
    ocrConfidence?: number;
  }) => Promise<string | null>;
  busy?: boolean;
}

export function ManualPaste({ onSubmit, busy }: Props) {
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrConfidence, setOcrConfidence] = useState<number | null>(null);

  const pasteFromClipboard = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t) {
        setText(t);
        toast.success('Texto colado');
      }
    } catch {
      toast.error('Não foi possível ler a área de transferência');
    }
  };

  const handleImage = async (file: File) => {
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setOcrBusy(true);
    setOcrConfidence(null);
    try {
      const res = await runOcr(file);
      setOcrConfidence(res.confidence);
      if (res.text) {
        setText((prev) => (prev ? prev + '\n\n' : '') + res.text);
        if (res.confidence < OCR_MIN_CONFIDENCE) {
          toast.warning(`OCR baixa confiança (${Math.round(res.confidence)}%) — Vision fará fallback no servidor`);
        } else {
          toast.success(`OCR extraído (${Math.round(res.confidence)}%)`);
        }
      } else {
        toast.warning('OCR não reconheceu texto — Vision fará fallback');
      }
    } catch (e: any) {
      toast.error(`Falha no OCR: ${e?.message ?? e}`);
    } finally {
      setOcrBusy(false);
    }
  };

  const clearImage = () => {
    setImageFile(null);
    setImagePreview(null);
    setOcrConfidence(null);
  };

  const handle = async () => {
    if (!text.trim() && !url.trim() && !imageFile) {
      toast.error('Cole texto, link ou anexe um screenshot da Superbet');
      return;
    }
    let imageBase64: string | undefined;
    if (imageFile) {
      try { imageBase64 = await fileToBase64(imageFile); }
      catch { toast.error('Falha ao codificar imagem'); return; }
    }
    const id = await onSubmit({
      rawText: text.trim() || undefined,
      sourceUrl: url.trim() || undefined,
      imageBase64,
      ocrConfidence: ocrConfidence ?? undefined,
    });
    if (id) {
      toast.success('Captura enviada — aguardando análise');
      setText(''); setUrl(''); clearImage();
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-white/10 bg-black/40 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Colar manualmente</h3>
        <Button variant="ghost" size="sm" onClick={pasteFromClipboard}>
          <Clipboard className="h-4 w-4" />
          <span className="ml-1">Colar</span>
        </Button>
      </div>
      <Input
        placeholder="URL do jogo na Superbet (opcional)"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        className="bg-black/60 border-white/10 text-white"
      />
      <Textarea
        placeholder="Cole aqui odds, estatísticas, escalações, H2H... ou anexe um screenshot abaixo"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        className="bg-black/60 border-white/10 text-white text-sm"
      />

      <div className="space-y-2">
        <label className="flex cursor-pointer items-center gap-2 rounded border border-dashed border-white/15 bg-black/30 p-3 text-xs text-white/70 hover:bg-black/50">
          {ocrBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4 text-amber-400" />}
          <span>
            {ocrBusy ? 'Lendo imagem com OCR...' : 'Anexar screenshot (OCR local Tesseract)'}
          </span>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={ocrBusy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImage(f);
              e.target.value = '';
            }}
          />
        </label>
        {imagePreview && (
          <div className="relative inline-block">
            <img src={imagePreview} alt="preview" className="max-h-32 rounded border border-white/10" />
            <button
              onClick={clearImage}
              className="absolute -right-2 -top-2 rounded-full bg-black/80 p-1 text-white/70 hover:text-white"
            >
              <X className="h-3 w-3" />
            </button>
            {ocrConfidence !== null && (
              <p className="mt-1 text-[10px] text-white/50">
                OCR: {Math.round(ocrConfidence)}% {ocrConfidence < OCR_MIN_CONFIDENCE && '(Vision fará fallback)'}
              </p>
            )}
          </div>
        )}
      </div>

      <Button onClick={handle} disabled={busy || ocrBusy} className="w-full">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        <span className="ml-2">Enviar para análise</span>
      </Button>
    </div>
  );
}
