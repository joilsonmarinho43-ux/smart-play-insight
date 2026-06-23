import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Clipboard, Send, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  onSubmit: (input: { rawText?: string; sourceUrl?: string }) => Promise<string | null>;
  busy?: boolean;
}

export function ManualPaste({ onSubmit, busy }: Props) {
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');

  const pasteFromClipboard = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t) {
        setText(t);
        toast.success('Texto colado da área de transferência');
      }
    } catch {
      toast.error('Não foi possível ler a área de transferência');
    }
  };

  const handle = async () => {
    if (!text.trim() && !url.trim()) {
      toast.error('Cole um texto ou link da Superbet primeiro');
      return;
    }
    const id = await onSubmit({
      rawText: text.trim() || undefined,
      sourceUrl: url.trim() || undefined,
    });
    if (id) {
      toast.success('Captura enviada — aguardando análise');
      setText('');
      setUrl('');
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
        placeholder="Cole aqui odds, estatísticas, escalações, H2H... qualquer texto da Superbet"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        className="bg-black/60 border-white/10 text-white text-sm"
      />
      <Button onClick={handle} disabled={busy} className="w-full">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        <span className="ml-2">Enviar para análise</span>
      </Button>
    </div>
  );
}
