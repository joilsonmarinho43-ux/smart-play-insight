import { supabase } from '@/integrations/supabase/client';
import { MatchData } from '@/types/match';

// =============================
// CACHE PERSISTENTE (LocalStorage para não gastar API Pro no Refresh)
// =============================
const CACHE_KEYS = {
  PRE: 'football_cache_pre',
  LIVE: 'football_cache_live',
  TIME_PRE: 'football_cache_pre_time',
  TIME_LIVE: 'football_cache_live_time'
};

const PRE_MATCH_COOLDOWN = 1000 * 60 * 10; // 10 minutos para Pré-Jogo
const LIVE_MATCH_COOLDOWN = 1000 * 20;     // 20 segundos para Live

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
// PRÉ-JOGO (Corrigido para economizar API)
// =============================
export async function fetchMatches(date: string): Promise<MatchData[]> {
  const cached = getStorageCache(CACHE_KEYS.PRE, CACHE_KEYS.TIME_PRE, PRE_MATCH_COOLDOWN);
  if (cached) return cached;

  try {
    const { data, error } = await supabase.functions.invoke('football-api', {
      body: { date },
    });

    if (error) throw error;

    console.log('[fetchMatches] raw response:', JSON.stringify(data).slice(0, 500));
    const raw = Array.isArray(data?.matches) ? data.matches : [];
    console.log(`[fetchMatches] ${raw.length} raw matches, filtering...`);
    
    // Filtro profissional: remove jogos sem dados essenciais para o Trade
    const result = raw.filter((m: any) => m.teams?.home?.name && m.fixture?.id);
    console.log(`[fetchMatches] ${result.length} matches after filter`);

    if (result.length > 0) {
      localStorage.setItem(CACHE_KEYS.PRE, JSON.stringify(result));
      localStorage.setItem(CACHE_KEYS.TIME_PRE, String(Date.now()));
    }

    return result;
  } catch (err) {
    console.error('Erro PRE:', err);
    return [];
  }
}

// =============================
// LIVE REAL (Filtro de Status de Alta Precisão)
// =============================
export async function fetchLiveMatches(): Promise<MatchData[]> {
  const cached = getStorageCache(CACHE_KEYS.LIVE, CACHE_KEYS.TIME_LIVE, LIVE_MATCH_COOLDOWN);
  if (cached) return cached;

  try {
    const { data, error } = await supabase.functions.invoke('football-api', {
      body: { live: true },
    });

    if (error) throw error;

    const raw = Array.isArray(data?.matches) ? data.matches : (Array.isArray(data) ? data : []);

    // Status reais da API-Sports para jogo rolando
    const liveStatuses = ['1H', '2H', 'HT', 'ET', 'P', 'LIVE'];

    const result = raw.filter((match: any) => {
      const status = (match?.fixture?.status?.short || '').toUpperCase();
      return liveStatuses.includes(status);
    });

    if (result.length > 0) {
      localStorage.setItem(CACHE_KEYS.LIVE, JSON.stringify(result));
      localStorage.setItem(CACHE_KEYS.TIME_LIVE, String(Date.now()));
    }

    return result;
  } catch (err) {
    console.error('Erro LIVE:', err);
    return [];
  }
}

// =============================
// ESTATÍSTICAS (Otimizado para não repetir chamadas)
// =============================
export async function fetchMatchStats(matchId: number) {
  try {
    const { data, error } = await supabase.functions.invoke('football-api', {
      body: { fixture: matchId },
    });

    if (error) throw error;
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
