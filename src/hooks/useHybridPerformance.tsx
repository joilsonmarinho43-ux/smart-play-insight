import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  getPerformance,
  registerEntry,
  resolveEntry,
  getPendingForMatch,
  type HybridPerformance,
  type HybridEntryRow,
} from '@/lib/hybridStore';
import type { HybridSignal } from '@/lib/hybridEngine';

/**
 * Hook que sincroniza o painel de performance com o banco (Supabase).
 * Substitui localStorage para garantir sincronia PC ↔ celular.
 */
export function useHybridPerformance() {
  const [performance, setPerformance] = useState<HybridPerformance | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const perf = await getPerformance();
    setPerformance(perf);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    // realtime updates quando inserir/atualizar entradas
    const channel = supabase
      .channel('hybrid_entries_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'hybrid_entries' },
        () => refresh(),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [refresh]);

  const registerSignal = useCallback(async (signal: HybridSignal): Promise<HybridEntryRow | null> => {
    if (!signal.canExecute) return null;
    const existing = await getPendingForMatch(signal.matchId);
    if (existing) return existing;
    const row = await registerEntry(signal, signal.daEstimated);
    if (row) await refresh();
    return row;
  }, [refresh]);

  const resolve = useCallback(async (id: string, result: 'WIN' | 'LOSS' | 'CASHOUT', exitMinute?: number) => {
    await resolveEntry(id, result, exitMinute);
    await refresh();
  }, [refresh]);

  return { performance, loading, refresh, registerSignal, resolve };
}
