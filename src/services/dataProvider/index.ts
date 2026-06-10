// =====================================================================
// DATA PROVIDER UNIFICADO — Pré-Jogo
// ---------------------------------------------------------------------
// Camada única que orquestra múltiplas fontes de dados de futebol com
// fallback automático. NÃO altera a interface. NÃO remove funcionalidades.
//
// Princípios:
// 1. API principal (Edge Function football-api) é a fonte preferida.
// 2. Fontes secundárias são plugáveis via registerSource() — opcionais.
// 3. Cache local (mesmo expirado) é sempre a última rede de segurança.
// 4. Nenhum erro de API quebra a UI — retornamos parcial em vez de throw.
// 5. Deduplicação por assinatura normalizada (data + times normalizados).
//
// Migração incremental: por enquanto só Pré-Jogo (Home) usa o provider.
// Live/Scanner/Elite seguem usando footballApi.ts diretamente.
// =====================================================================

import { MatchData } from '@/types/match';
import { matchSignature } from './normalize';

export interface MatchSource {
  name: string;
  priority: number; // menor = maior prioridade
  fetchByDate: (date: string) => Promise<MatchData[]>;
  isAvailable?: () => boolean | Promise<boolean>;
}

type ProviderLog = {
  ts: number;
  date: string;
  source: string;
  status: 'ok' | 'empty' | 'error';
  count: number;
  durationMs?: number;
  error?: string;
};

const LOG_KEY = 'data_provider_log_v1';
const MAX_LOG_ENTRIES = 50;

const sources: MatchSource[] = [];

export function registerSource(s: MatchSource): void {
  // Substitui se já existe um source com o mesmo nome
  const idx = sources.findIndex(x => x.name === s.name);
  if (idx >= 0) sources[idx] = s;
  else sources.push(s);
  sources.sort((a, b) => a.priority - b.priority);
}

export function listSources(): { name: string; priority: number }[] {
  return sources.map(s => ({ name: s.name, priority: s.priority }));
}

function pushLog(entry: ProviderLog) {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    const arr: ProviderLog[] = raw ? JSON.parse(raw) : [];
    arr.unshift(entry);
    localStorage.setItem(LOG_KEY, JSON.stringify(arr.slice(0, MAX_LOG_ENTRIES)));
  } catch { /* noop */ }
}

export function getProviderLog(): ProviderLog[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function dedupe(matches: MatchData[]): MatchData[] {
  const seen = new Set<string>();
  const out: MatchData[] = [];
  for (const m of matches) {
    const home = (m as any).teams?.home?.name || (m as any).homeTeam || '';
    const away = (m as any).teams?.away?.name || (m as any).awayTeam || '';
    const date = (m as any).fixture?.date || (m as any).date || '';
    const id = (m as any).id || (m as any).fixture?.id;
    // Prioriza ID quando disponível, senão usa assinatura normalizada
    const key = id ? `id:${id}` : matchSignature(home, away, date);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

/**
 * Busca jogos para uma data, MESCLANDO resultados das fontes em ordem
 * de prioridade. A fonte primária vence em caso de conflito (mesmo jogo);
 * fontes secundárias preenchem partidas que a primária NÃO trouxe.
 *
 * Fontes com prioridade >= 90 (ex.: stale-local-cache) são usadas SOMENTE
 * como último recurso, se nada veio das fontes "vivas".
 *
 * NUNCA lança exceção — erros são logados internamente.
 */
export async function getMatchesByDate(date: string): Promise<MatchData[]> {
  const live = sources.filter(s => s.priority < 90);
  const lastResort = sources.filter(s => s.priority >= 90);

  const merged: MatchData[] = [];

  for (const src of live) {
    const t0 = performance.now();
    try {
      if (src.isAvailable) {
        const ok = await src.isAvailable();
        if (!ok) {
          pushLog({ ts: Date.now(), date, source: src.name, status: 'empty', count: 0, durationMs: Math.round(performance.now() - t0), error: 'unavailable' });
          continue;
        }
      }
      const result = await src.fetchByDate(date);
      const arr = Array.isArray(result) ? result : [];
      const durationMs = Math.round(performance.now() - t0);
      // tag de fonte (não-invasivo) para diagnóstico — usado apenas em telas admin
      const tagged = arr.map(m => ({ ...(m as any), __source: src.name } as MatchData));
      if (tagged.length > 0) {
        pushLog({ ts: Date.now(), date, source: src.name, status: 'ok', count: tagged.length, durationMs });
        merged.push(...tagged); // dedupe preserva a 1ª (maior prioridade)
      } else {
        pushLog({ ts: Date.now(), date, source: src.name, status: 'empty', count: 0, durationMs });
      }
    } catch (err: any) {
      pushLog({
        ts: Date.now(), date, source: src.name, status: 'error', count: 0,
        durationMs: Math.round(performance.now() - t0),
        error: err?.message || String(err),
      });
    }
  }

  if (merged.length > 0) return dedupe(merged);

  for (const src of lastResort) {
    const t0 = performance.now();
    try {
      const arr = await src.fetchByDate(date);
      const durationMs = Math.round(performance.now() - t0);
      if (Array.isArray(arr) && arr.length > 0) {
        const tagged = arr.map(m => ({ ...(m as any), __source: src.name } as MatchData));
        pushLog({ ts: Date.now(), date, source: src.name, status: 'ok', count: tagged.length, durationMs });
        return dedupe(tagged);
      }
    } catch (err: any) {
      pushLog({
        ts: Date.now(), date, source: src.name, status: 'error', count: 0,
        durationMs: Math.round(performance.now() - t0),
        error: err?.message || String(err),
      });
    }
  }
  return [];
}

/**
 * Versão multi-dia: agrega resultados de várias datas, deduplicando.
 */
export async function getMatchesForDays(dates: string[]): Promise<MatchData[]> {
  const results = await Promise.allSettled(dates.map(d => getMatchesByDate(d)));
  const all: MatchData[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') all.push(...r.value);
  }
  return dedupe(all);
}

// =====================================================================
// DIAGNÓSTICO (admin) — executa cada fonte individualmente para uma data
// e retorna métricas (tempo, contagem, erro). Não afeta a UI normal.
// =====================================================================
export interface SourceProbe {
  source: string;
  priority: number;
  status: 'ok' | 'empty' | 'error';
  count: number;
  durationMs: number;
  error?: string;
  sample?: MatchData[];
}

export async function probeAllSources(date: string): Promise<SourceProbe[]> {
  const out: SourceProbe[] = [];
  for (const src of sources) {
    const t0 = performance.now();
    try {
      if (src.isAvailable) {
        const ok = await src.isAvailable();
        if (!ok) {
          out.push({ source: src.name, priority: src.priority, status: 'error', count: 0, durationMs: Math.round(performance.now() - t0), error: 'unavailable' });
          continue;
        }
      }
      const arr = await src.fetchByDate(date);
      const list = Array.isArray(arr) ? arr : [];
      out.push({
        source: src.name,
        priority: src.priority,
        status: list.length > 0 ? 'ok' : 'empty',
        count: list.length,
        durationMs: Math.round(performance.now() - t0),
        sample: list.slice(0, 5),
      });
    } catch (err: any) {
      out.push({
        source: src.name, priority: src.priority, status: 'error', count: 0,
        durationMs: Math.round(performance.now() - t0),
        error: err?.message || String(err),
      });
    }
  }
  return out;
}

