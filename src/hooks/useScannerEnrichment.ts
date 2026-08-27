// Enriquecimento em lote para Scanner PRO, Elite, Bingo, Placar Exato e Bet Analyzer.
//
// As fontes de fixtures não trazem médias de gols/amostra. Sem isso o modelo
// Poisson cai na média da liga e todos os jogos ficam genéricos (ou somem, pois
// os módulos exigem histórico real).
//
// Arquitetura (compatível com Lovable Cloud E VPS self-hosted):
//   • Requisições por TIME (não por jogo) — evita buscar o mesmo time N vezes.
//   • Uma única chamada em LOTE por bloco de 12 times (`team-form` modo batch),
//     em vez de dezenas de invocações paralelas — o edge-runtime self-hosted
//     tem 1 container e derrubava as chamadas concorrentes (telas vazias).
//   • Cache local persistente de 12h por time — recarregar a página não refaz
//     as buscas e os módulos abrem instantâneos.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { MatchData } from '@/types/match';
import { mergeFormIntoMatch } from '@/hooks/useTeamForm';

/** Máximo de partidas enriquecidas por varredura. */
const MAX_ENRICH = 36;
/** Times por requisição em lote. */
const BATCH_SIZE = 12;
/** Lotes simultâneos (baixo de propósito: self-host tem 1 worker). */
const BATCH_CONCURRENCY = 2;

const LS_PREFIX = 'team_form_v2_';
const LS_TTL = 1000 * 60 * 60 * 12; // 12h

function keyOf(name: string): string {
  return String(name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function lsGet(name: string): any | null {
  try {
    const raw = localStorage.getItem(LS_PREFIX + keyOf(name));
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > LS_TTL) return null;
    if (!data || Number(data.games) <= 0) return null;
    return data;
  } catch { return null; }
}

function lsSet(name: string, data: any) {
  if (!data || Number(data.games) <= 0) return;
  try {
    localStorage.setItem(LS_PREFIX + keyOf(name), JSON.stringify({ ts: Date.now(), data }));
  } catch { /* quota cheia — segue sem cache */ }
}

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

/** Busca a forma de vários times numa única invocação. */
async function fetchBatch(teams: string[]): Promise<Record<string, any>> {
  try {
    const { data, error } = await supabase.functions.invoke('team-form', { body: { teams } });
    if (error || !data?.ok || !data?.forms) return {};
    const out: Record<string, any> = {};
    for (const [name, form] of Object.entries<any>(data.forms)) {
      if (form && Number(form.games) > 0) {
        out[keyOf(name)] = form;
        lsSet(name, form);
      }
    }
    return out;
  } catch {
    return {};
  }
}

async function runBatches(teams: string[]): Promise<Record<string, any>> {
  const chunks: string[][] = [];
  for (let i = 0; i < teams.length; i += BATCH_SIZE) chunks.push(teams.slice(i, i + BATCH_SIZE));

  const merged: Record<string, any> = {};
  let cursor = 0;
  const workers = Array.from({ length: Math.min(BATCH_CONCURRENCY, chunks.length) }, async () => {
    while (cursor < chunks.length) {
      const chunk = chunks[cursor++];
      Object.assign(merged, await fetchBatch(chunk));
    }
  });
  await Promise.all(workers);
  return merged;
}

/**
 * Retorna as partidas com estatísticas reais mescladas.
 * Enquanto carrega, devolve a lista original para a UI não ficar vazia.
 */
export function useScannerEnrichment(matches: MatchData[]) {
  const pending = (matches || []).filter(m => !hasRealData(m)).slice(0, MAX_ENRICH);

  // Times únicos ainda sem cache local válido
  const needed: string[] = [];
  const seen = new Set<string>();
  for (const m of pending) {
    for (const name of [m.homeTeam as string, m.awayTeam as string]) {
      const k = keyOf(name);
      if (!name || seen.has(k)) continue;
      seen.add(k);
      if (!lsGet(name)) needed.push(name);
    }
  }

  const signature = needed.slice().sort().join(',');

  const { data: fetchedMap, isFetching } = useQuery({
    queryKey: ['team-form-batch', signature],
    enabled: needed.length > 0,
    staleTime: 1000 * 60 * 60 * 12,
    gcTime: 1000 * 60 * 60 * 24,
    retry: 0,
    queryFn: () => runBatches(needed),
  });

  const formOf = (name: string) => fetchedMap?.[keyOf(name)] || lsGet(name) || null;

  const enriched = (matches || []).map(m => {
    const h = formOf(m.homeTeam as string);
    const a = formOf(m.awayTeam as string);
    if (!h && !a) return m;
    return mergeFormIntoMatch(m, { ok: true, home: h || undefined, away: a || undefined } as any);
  });

  const enrichedCount = enriched.filter(hasRealData).length;

  return { matches: enriched, isEnriching: isFetching, enrichedCount };
}
