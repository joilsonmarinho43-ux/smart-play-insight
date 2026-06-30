// Source: SportsRC v2 (api.sportsrc.org)
// Plano FREE: 1000 req/dia. Cobertura ampla de fixtures, status live,
// odds, stats, lineups, incidents, h2h — via edge proxy `free-football-proxy`.

import { MatchData } from '@/types/match';
import { supabase } from '@/integrations/supabase/client';

const CACHE_PREFIX = 'sportsrc_cache_';
const STALE_PREFIX = 'sportsrc_stale_';
const CACHE_TTL = 1000 * 60 * 60 * 12; // 12h fresh (proxy também cacheia 6h)
const STALE_MAX = 1000 * 60 * 60 * 24 * 7; // 7d último recurso quando upstream falha

const LIVE_STATUSES = new Set(['live', 'inprogress', 'in_progress', '1h', '2h', 'ht', 'halftime']);

function mapMatch(m: any, leagueMeta: any): MatchData | null {
  try {
    const id = String(m?.id ?? '');
    const home = m?.teams?.home?.name || '';
    const away = m?.teams?.away?.name || '';
    if (!id || !home || !away) return null;
    const ts: number | undefined = typeof m?.timestamp === 'number' ? m.timestamp : undefined;
    const iso = ts ? new Date(ts).toISOString() : new Date().toISOString();
    const status = String(m?.status || '').toLowerCase();
    const isLive = LIVE_STATUSES.has(status);
    const score = m?.score?.current || {};
    return {
      id: `srcv2-${id}`,
      time: iso,
      league: leagueMeta?.name || 'Outros',
      homeTeam: home,
      awayTeam: away,
      homeLogo: m?.teams?.home?.badge || undefined,
      awayLogo: m?.teams?.away?.badge || undefined,
      isLive,
      status: m?.status_detail || m?.status || undefined,
      liveScore: isLive && typeof score.home === 'number' && typeof score.away === 'number'
        ? { home: score.home, away: score.away }
        : undefined,
    } as MatchData;
  } catch { return null; }
}

export async function fetchSportsRC(date: string): Promise<MatchData[]> {
  // 1) Cache fresco local (12h)
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + date);
    if (raw) {
      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts < CACHE_TTL && Array.isArray(data) && data.length > 0) return data;
    }
  } catch { /* noop */ }

  const returnStale = (reason: string): MatchData[] => {
    try {
      const raw = localStorage.getItem(STALE_PREFIX + date);
      if (!raw) return [];
      const { ts, data } = JSON.parse(raw);
      if (!Array.isArray(data) || Date.now() - ts > STALE_MAX) return [];
      console.warn(`[SportsRC] ${reason} → servindo stale (age=${Math.round((Date.now() - ts) / 60000)}min, n=${data.length})`);
      return data;
    } catch { return []; }
  };

  try {
    const { data, error } = await supabase.functions.invoke('free-football-proxy', {
      body: {
        provider: 'sportsrc',
        path: '/',
        params: { type: 'matches', date },
      },
    });
    if (error || !data?.ok) {
      console.warn('[SportsRC] proxy_error', { error, body: data });
      return returnStale('proxy_error');
    }
    const payload = data.data;
    const groups: any[] = Array.isArray(payload?.data) ? payload.data : [];
    const matches: MatchData[] = [];
    for (const g of groups) {
      const league = g?.league || null;
      const list: any[] = Array.isArray(g?.matches) ? g.matches : [];
      for (const m of list) {
        const mapped = mapMatch(m, league);
        if (mapped) matches.push(mapped);
      }
    }
    if (matches.length === 0) {
      // upstream pode ter devolvido vazio por limite — preserva snapshot anterior
      console.info(`[SportsRC] date=${date} vazio (cache=${data.cache || 'miss'})`);
      return returnStale('upstream_empty');
    }
    try {
      const snap = JSON.stringify({ ts: Date.now(), data: matches });
      localStorage.setItem(CACHE_PREFIX + date, snap);
      localStorage.setItem(STALE_PREFIX + date, snap);
    } catch { /* noop */ }
    console.info(`[SportsRC] date=${date} matches=${matches.length} cache=${data.cache || 'miss'} latency=${data.latency_ms}ms${data.served_from_stale ? ' STALE' : ''}`);
    return matches;
  } catch (e) {
    console.warn('[SportsRC] fetch_exception', e);
    return returnStale('fetch_exception');
  }
}
