import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { SuperbetCaptureRow } from '../types';

interface SubmitInput {
  rawText?: string;
  sourceUrl?: string;
  imageBase64?: string;
  marketHint?: string;
  ocrConfidence?: number;
}

export function useCaptureStore() {
  const [captures, setCaptures] = useState<SuperbetCaptureRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from('superbet_captures')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (err) setError(err.message);
    else setCaptures((data ?? []) as SuperbetCaptureRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const submit = useCallback(async (input: SubmitInput) => {
    setError(null);
    const { data: user } = await supabase.auth.getUser();
    const uid = user.user?.id;
    if (!uid) {
      setError('Sessão expirada. Faça login novamente.');
      return null;
    }

    // 1) cria registro pending para feedback imediato
    const { data: inserted, error: insErr } = await supabase
      .from('superbet_captures')
      .insert({
        user_id: uid,
        raw_text: input.rawText ?? null,
        source_url: input.sourceUrl ?? null,
        market_hint: input.marketHint ?? null,
        status: 'pending',
      })
      .select()
      .single();
    if (insErr || !inserted) {
      setError(insErr?.message ?? 'Falha ao salvar captura');
      return null;
    }

    // 2) dispara parser (edge function stub na Fase 1)
    try {
      const { data: parsed, error: fnErr } = await supabase.functions.invoke('superbet-parse', {
        body: {
          captureId: inserted.id,
          text: input.rawText ?? null,
          sourceUrl: input.sourceUrl ?? null,
          imageBase64: input.imageBase64 ?? null,
          imageBase64: input.imageBase64 ?? null,
          marketHint: input.marketHint ?? null,
          ocrConfidence: input.ocrConfidence ?? null,
        },
      });
      if (fnErr) throw fnErr;
      await supabase.from('superbet_captures').update({
        status: 'parsed',
        parsed_json: parsed ?? null,
        parser_version: (parsed as any)?.parserVersion ?? null,
        confidence: (parsed as any)?.confidence ?? null,
      }).eq('id', inserted.id);
    } catch (err: any) {
      await supabase.from('superbet_captures').update({
        status: 'failed',
        parsed_json: { error: err?.message ?? String(err) },
      }).eq('id', inserted.id);
    }

    await refresh();
    return inserted.id;
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    await supabase.from('superbet_captures').delete().eq('id', id);
    await refresh();
  }, [refresh]);

  return { captures, loading, error, refresh, submit, remove };
}
