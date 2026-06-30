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
  // Cache local 6h
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + date);
    if (raw) {
      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts < CACHE_TTL && Array.isArray(data)) return data;
    }
  } catch { /* noop */ }

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
      return [];
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
    try {
      localStorage.setItem(CACHE_PREFIX + date, JSON.stringify({ ts: Date.now(), data: matches }));
    } catch { /* noop */ }
    console.info(`[SportsRC] date=${date} matches=${matches.length} latency=${data.latency_ms}ms`);
    return matches;
  } catch (e) {
    console.warn('[SportsRC] fetch_exception', e);
    return [];
  }
}
