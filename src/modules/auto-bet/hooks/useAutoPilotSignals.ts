// ============================================================
// Lê SOMENTE LEITURA da tabela telegram_signals.
// Não escreve, não modifica, não interfere em nada.
// ============================================================

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AutoPilotSignal } from "../types";

export function useAutoPilotSignals(minutesWindow = 30) {
  return useQuery<AutoPilotSignal[]>({
    queryKey: ["autopilot-signals", minutesWindow],
    queryFn: async () => {
      const since = new Date(Date.now() - minutesWindow * 60_000).toISOString();
      const { data, error } = await supabase
        .from("telegram_signals")
        .select("id, match_id, match_name, league, market, minute, confidence, odd, created_at, reason")
        .gte("created_at", since)
        .eq("success", true)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as AutoPilotSignal[];
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}
