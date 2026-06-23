// Source: Football-Data.org (free tier, ~10 req/min, principais ligas)
// Usa o edge proxy `free-football-proxy` para esconder a chave e evitar CORS.

import { MatchData } from '@/types/match';
import { supabase } from '@/integrations/supabase/client';

const CACHE_PREFIX = 'fdo_cache_';
const CACHE_TTL = 1000 * 60 * 60 * 6; // 6h

function mapMatch(m: any): MatchData | null {
  try {
    const id = String(m?.id ?? '');
    const home = m?.homeTeam?.name || m?.homeTeam?.shortName || '';
    const away = m?.awayTeam?.name || m?.awayTeam?.shortName || '';
    if (!id || !home || !away) return null;
    const status: string = String(m?.status || '').toUpperCase();
    const liveStatuses = ['IN_PLAY', 'PAUSED', 'LIVE'];
    return {
      id: `fdo-${id}`,
      time: m?.utcDate || new Date().toISOString(),
      league: m?.competition?.name || 'Outros',
      homeTeam: home,
      awayTeam: away,
      homeLogo: m?.homeTeam?.crest || undefined,
      awayLogo: m?.awayTeam?.crest || undefined,
      isLive: liveStatuses.includes(status),
    } as MatchData;
  } catch { return null; }
}

export async function fetchFootballDataOrg(date: string): Promise<MatchData[]> {
  // Cache local
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
        provider: 'football-data-org',
        path: '/v4/matches',
        params: { dateFrom: date, dateTo: date },
      },
    });
    if (error) return [];
    if (!data?.ok) return [];
    const matches: any[] = Array.isArray(data?.data?.matches) ? data.data.matches : [];
    const mapped = matches.map(mapMatch).filter(Boolean) as MatchData[];
    try { localStorage.setItem(CACHE_PREFIX + date, JSON.stringify({ ts: Date.now(), data: mapped })); } catch {}
    return mapped;
  } catch {
    return [];
  }
}
