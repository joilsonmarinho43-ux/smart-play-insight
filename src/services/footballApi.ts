import { supabase } from '@/integrations/supabase/client';
import { MatchData } from '@/types/match';
import { APP_TIMEZONE, getTodayInPara } from '@/lib/timezone';

// =============================
// CACHE PERSISTENTE (LocalStorage)
// =============================
const CACHE_KEYS = {
  PRE: 'football_cache_pre',
  LIVE: 'football_cache_live',
  TIME_PRE: 'football_cache_pre_time',
  TIME_LIVE: 'football_cache_live_time'
};

const PRE_MATCH_COOLDOWN = 1000 * 60 * 60 * 24; // 24h
const LIVE_MATCH_COOLDOWN = 1000 * 55;     // 55s
const LIVE_STALE_HARD_MS = 1000 * 60 * 10; // 10min — força reset

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

const OFFLINE_REASON_KEY = 'football_offline_reason';
export function getOfflineReason(): string | null {
  return localStorage.getItem(OFFLINE_REASON_KEY);
}
function setOfflineReason(r: string | null) {
  if (r) localStorage.setItem(OFFLINE_REASON_KEY, r);
  else localStorage.removeItem(OFFLINE_REASON_KEY);
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

    // API retornou erro estruturado (ex.: conta suspensa)
    if (data?.error === 'api_suspended' || data?.warning === 'api_suspended') {
      setOfflineMode(true);
      setOfflineReason('api_suspended');
    } else if (result.length > 0) {
      localStorage.setItem(cacheKey, JSON.stringify(result));
      localStorage.setItem(cacheTimeKey, String(Date.now()));
      setOfflineMode(false); // API ok → sai do offline
      setOfflineReason(null);
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
// Agora passa pelo Data Provider Unificado (fallback automático entre fontes).
// =============================
export async function fetchMultiDayMatches(days: number = 3): Promise<MatchData[]> {
  const dates: string[] = [];
  const today = getTodayInPara(); // YYYY-MM-DD em Pará (UTC-3)
  const base = new Date(`${today}T12:00:00-03:00`);
  for (let i = 0; i < days; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    dates.push(new Intl.DateTimeFormat('en-CA', {
      timeZone: APP_TIMEZONE,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d));
  }

  // Import dinâmico evita ciclo de dependência (sources.ts importa este arquivo).
  const { getMatchesForDays } = await import('./dataProvider');
  return await getMatchesForDays(dates);
}


// =============================
// LIVE REAL
// =============================
export async function fetchLiveMatches(): Promise<MatchData[]> {
  // Hard-reset: se cache live tem >10min, descarta para forçar refetch
  const liveTime = Number(localStorage.getItem(CACHE_KEYS.TIME_LIVE) || 0);
  if (liveTime && Date.now() - liveTime > LIVE_STALE_HARD_MS) {
    console.warn('[LIVE] cache >10min — descartando para refetch forçado');
    localStorage.removeItem(CACHE_KEYS.LIVE);
    localStorage.removeItem(CACHE_KEYS.TIME_LIVE);
  }

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
      setOfflineMode(false);
    }

    return deduped;
  } catch (err) {
    console.error('Erro LIVE:', err);
    // Fallback: stale cache → modo offline
    const staleData = localStorage.getItem(CACHE_KEYS.LIVE);
    if (staleData) {
      console.warn('[OFFLINE] Servindo cache live expirado');
      setOfflineMode(true);
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
