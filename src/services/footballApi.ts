import { supabase } from '@/integrations/supabase/client';
import { MatchData } from '@/types/match';

// =============================
// CACHE PERSISTENTE (LocalStorage)
// =============================
const CACHE_KEYS = {
  PRE: 'football_cache_pre',
  LIVE: 'football_cache_live',
  TIME_PRE: 'football_cache_pre_time',
  TIME_LIVE: 'football_cache_live_time'
};

const PRE_MATCH_COOLDOWN = 1000 * 60 * 60 * 24; // 24h - Pré-Jogo carrega 1x por dia (economiza cota)
const LIVE_MATCH_COOLDOWN = 1000 * 55;     // 55 segundos para Live

// =============================
// MODO OFFLINE (cache expirado servido como fallback)
// =============================
const OFFLINE_FLAG_KEY = 'football_offline_mode';
const OFFLINE_SINCE_KEY = 'football_offline_since';

function setOfflineMode(active: boolean) {
  if (active) {
    localStorage.setItem(OFFLINE_FLAG_KEY, '1');
    if (!localStorage.getItem(OFFLINE_SINCE_KEY)) {
      localStorage.setItem(OFFLINE_SINCE_KEY, String(Date.now()));
    }
  } else {
    localStorage.removeItem(OFFLINE_FLAG_KEY);
    localStorage.removeItem(OFFLINE_SINCE_KEY);
  }
  try { window.dispatchEvent(new CustomEvent('football-offline-change')); } catch {}
}

export function isOfflineMode(): boolean {
  return localStorage.getItem(OFFLINE_FLAG_KEY) === '1';
}

export function getOfflineSince(): number | null {
  const t = localStorage.getItem(OFFLINE_SINCE_KEY);
  return t ? Number(t) : null;
}

function getStorageCache(key: string, timeKey: string, cooldown: number) {
  const data = localStorage.getItem(key);
  const time = localStorage.getItem(timeKey);
  const now = Date.now();
  if (data && time && (now - Number(time) < cooldown)) {
    return JSON.parse(data);
  }
  return null;
}

// =============================
// RETRY com fallback
// =============================
async function invokeWithRetry(body: any, retries = 2): Promise<any> {
  for (let i = 0; i <= retries; i++) {
    try {
      const { data, error } = await supabase.functions.invoke('football-api', { body });
      if (error) {
        console.warn(`API attempt ${i + 1} failed:`, error);
        if (i === retries) throw error;
        await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        continue;
      }
      return data;
    } catch (err) {
      console.warn(`API attempt ${i + 1} exception:`, err);
      if (i === retries) throw err;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

// =============================
// PRÉ-JOGO (com suporte a múltiplas datas)
// =============================
export async function fetchMatches(date: string): Promise<MatchData[]> {
  const cacheKey = `${CACHE_KEYS.PRE}_${date}`;
  const cacheTimeKey = `${CACHE_KEYS.TIME_PRE}_${date}`;
  const cached = getStorageCache(cacheKey, cacheTimeKey, PRE_MATCH_COOLDOWN);
  if (cached) return cached;

  try {
    const data = await invokeWithRetry({ date });
    const raw = Array.isArray(data?.matches) ? data.matches : [];
    const result = raw.filter((m: any) => (m.id || m.fixture?.id) && (m.homeTeam || m.teams?.home?.name));

    if (result.length > 0) {
      localStorage.setItem(cacheKey, JSON.stringify(result));
      localStorage.setItem(cacheTimeKey, String(Date.now()));
      setOfflineMode(false); // API ok → sai do offline
    }

    return result;
  } catch (err) {
    console.error('Erro PRE:', err);
    // Fallback: cache expirado → ativa modo offline
    const staleData = localStorage.getItem(cacheKey);
    if (staleData) {
      console.warn('[OFFLINE] Servindo cache expirado para', date);
      setOfflineMode(true);
      return JSON.parse(staleData);
    }
    return [];
  }
}

// =============================
// Buscar jogos de múltiplas datas (hoje + próximos dias)
// =============================
export async function fetchMultiDayMatches(days: number = 3): Promise<MatchData[]> {
  const dates: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().split('T')[0]);
  }

  const results = await Promise.allSettled(dates.map(d => fetchMatches(d)));
  const allMatches: MatchData[] = [];
  const seenIds = new Set<string>();

  for (const result of results) {
    if (result.status === 'fulfilled') {
      for (const m of result.value) {
        const id = m.id || (m as any).fixture?.id;
        if (id && !seenIds.has(String(id))) {
          seenIds.add(String(id));
          allMatches.push(m);
        }
      }
    }
  }

  return allMatches;
}

// =============================
// LIVE REAL
// =============================
export async function fetchLiveMatches(): Promise<MatchData[]> {
  const cached = getStorageCache(CACHE_KEYS.LIVE, CACHE_KEYS.TIME_LIVE, LIVE_MATCH_COOLDOWN);
  if (cached) return cached;

  try {
    const data = await invokeWithRetry({ live: true });
    const raw = Array.isArray(data?.matches) ? data.matches : (Array.isArray(data) ? data : []);

    const liveStatuses = ['1H', '2H', 'HT', 'ET', 'P', 'LIVE'];
    const result = raw.filter((match: any) => {
      const status = (match?.fixture?.status?.short || '').toUpperCase();
      return liveStatuses.includes(status);
    });

    // Deduplicação
    const seen = new Set<string>();
    const deduped = result.filter((m: any) => {
      const id = String(m?.id || m?.fixture?.id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    if (deduped.length > 0) {
      localStorage.setItem(CACHE_KEYS.LIVE, JSON.stringify(deduped));
      localStorage.setItem(CACHE_KEYS.TIME_LIVE, String(Date.now()));
    }

    return deduped;
  } catch (err) {
    console.error('Erro LIVE:', err);
    // Fallback: stale cache
    const staleData = localStorage.getItem(CACHE_KEYS.LIVE);
    if (staleData) {
      console.warn('Usando cache live expirado como fallback');
      return JSON.parse(staleData);
    }
    return [];
  }
}

// =============================
// ESTATÍSTICAS
// =============================
export async function fetchMatchStats(matchId: number) {
  try {
    const data = await invokeWithRetry({ fixture: matchId });
    const stats = data?.response || [];
    if (!stats.length) return null;

    const extract = (teamStats: any) => {
      const get = (type: string) => teamStats.find((s: any) => s.type === type)?.value || 0;
      return {
        shotsOnGoal: Number(get('Shots on Goal')),
        possession: String(get('Ball Possession')).replace('%', ''),
        corners: Number(get('Corner Kicks')),
        dangerousAttacks: Number(get('Dangerous Attacks')),
        totalShots: Number(get('Total Shots')),
      };
    };

    return {
      home: extract(stats[0]?.statistics || []),
      away: extract(stats[1]?.statistics || [])
    };
  } catch (err) {
    return null;
  }
}
