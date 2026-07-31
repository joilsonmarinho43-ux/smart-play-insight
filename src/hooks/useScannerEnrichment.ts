// Enriquecimento em lote para o Scanner PRO.
//
// O Scanner recebe as partidas direto da fonte de fixtures, que frequentemente
// não traz médias de gols/amostra. Sem isso o modelo Poisson cai na média da
// liga e TODOS os jogos produzem exatamente os mesmos números (genérico).
// Aqui buscamos os últimos jogos via edge function `team-form` para um conjunto
// limitado de partidas e mesclamos os dados reais em cada MatchData.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { MatchData } from '@/types/match';
import { mergeFormIntoMatch } from '@/hooks/useTeamForm';

/** Máximo de partidas enriquecidas por varredura (protege a cota da API). */
const MAX_ENRICH = 24;
/** Requisições simultâneas à edge function. */
const CONCURRENCY = 4;

function hasRealData(m: any): boolean {
  const md = m?.modelData || {};
  const hs = m?.homeStats || {};
  const as_ = m?.awayStats || {};
  const games = Math.min(
    Number(m?.sampleSize?.homeGames ?? hs.gamesCount ?? 0),
    Number(m?.sampleSize?.awayGames ?? as_.gamesCount ?? 0),
  );
  const avgs = Number(md.homeGoalsAvg ?? hs.goalsFor ?? 0) > 0 &&
    Number(md.awayGoalsAvg ?? as_.goalsFor ?? 0) > 0;
  return games > 0 && avgs;
}

async function fetchForm(home: string, away: string) {
  try {
    const { data, error } = await supabase.functions.invoke('team-form', {
      body: { home, away },
    });
    if (error || !data?.ok) return null;
    return data;
  } catch {
    return null;
  }
}

/** Executa tarefas com limite de paralelismo. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Retorna as partidas com estatísticas reais mescladas.
 * Enquanto carrega, devolve a lista original para a UI não ficar vazia.
 */
export function useScannerEnrichment(matches: MatchData[]) {
  // Partidas que precisam de enriquecimento (sem dados reais)
  const pending = (matches || []).filter(m => !hasRealData(m)).slice(0, MAX_ENRICH);
  const signature = pending.map(m => `${m.homeTeam}|${m.awayTeam}`).join(',');

  const { data: formMap, isFetching } = useQuery({
    queryKey: ['scanner-enrichment', signature],
    enabled: pending.length > 0,
    staleTime: 1000 * 60 * 60 * 12, // 12h — mesma janela do useTeamForm
    gcTime: 1000 * 60 * 60 * 24,
    retry: 0,
    queryFn: async () => {
      const forms = await pool(pending, CONCURRENCY, m =>
        fetchForm(m.homeTeam as string, m.awayTeam as string),
      );
      const map: Record<string, any> = {};
      pending.forEach((m, i) => {
        if (forms[i]) map[`${m.homeTeam}|${m.awayTeam}`] = forms[i];
      });
      return map;
    },
  });

  const enriched = (matches || []).map(m => {
    const form = formMap?.[`${m.homeTeam}|${m.awayTeam}`];
    return form ? mergeFormIntoMatch(m, form) : m;
  });

  return {
    matches: enriched,
    isEnriching: isFetching,
    enrichedCount: formMap ? Object.keys(formMap).length : 0,
  };
}
