import { supabase } from '@/integrations/supabase/client';
import { MatchData } from '@/types/match';

// =============================
// CACHE INTELIGENTE
// =============================
let cachePre: MatchData[] = [];
let lastFetchPre = 0;

let cacheLive: MatchData[] = [];
let lastFetchLive = 0;

const PRE_MATCH_COOLDOWN = 1000 * 60 * 2;
const LIVE_MATCH_COOLDOWN = 1000 * 30;

// =============================
// VALIDAÇÃO (MAIS FLEXÍVEL)
// =============================
function isValidMatch(match: MatchData): boolean {
  if (!match) return false;

  // 🔥 NÃO remove jogo por falta de estatística
  if (!match.teams || !match.fixture) return false;

  return true;
}

// =============================
// PRÉ-JOGO
// =============================
export async function fetchMatches(date: string): Promise<MatchData[]> {
  const now = Date.now();

  if (cachePre.length > 0 && (now - lastFetchPre < PRE_MATCH_COOLDOWN)) {
    return cachePre;
  }

  try {
    const { data, error } = await supabase.functions.invoke('football-api', {
      body: { date },
    });

    if (error) throw error;

    const raw =
      Array.isArray(data?.matches) ? data.matches :
      Array.isArray(data?.response) ? data.response :
      [];

    const result = raw.filter(isValidMatch);

    if (result.length > 0) {
      cachePre = result;
      lastFetchPre = now;
    }

    return result.length > 0 ? result : cachePre;

  } catch (err) {
    console.error('Erro PRE:', err);
    return cachePre;
  }
}

// =============================
// LIVE REAL
// =============================
export async function fetchLiveMatches(): Promise<MatchData[]> {
  const now = Date.now();

  if (cacheLive.length > 0 && (now - lastFetchLive < LIVE_MATCH_COOLDOWN)) {
    return cacheLive;
  }

  try {
    const { data, error } = await supabase.functions.invoke('football-api', {
      body: { live: true },
    });

    if (error) throw error;

    const raw =
      Array.isArray(data) ? data :
      Array.isArray(data?.matches) ? data.matches :
      Array.isArray(data?.response) ? data.response :
      [];

    // 🔥 FILTRO CORRETO DE LIVE
    const liveStatuses = ['1H', '2H', 'HT', 'LIVE', 'ET', 'P'];

    const result = raw.filter((match: any) => {
      const status = (match?.fixture?.status?.short || '').toUpperCase();
      return liveStatuses.includes(status);
    });

    if (result.length > 0) {
      cacheLive = result;
      lastFetchLive = now;
    }

    return result.length > 0 ? result : cacheLive;

  } catch (err) {
    console.error('Erro LIVE:', err);
    return cacheLive;
  }
}

// =============================
// 🔥 NOVO: ESTATÍSTICAS DO JOGO
// =============================
export async function fetchMatchStats(matchId: number) {
  try {
    const { data, error } = await supabase.functions.invoke('football-api', {
      body: { fixture: matchId },
    });

    if (error) throw error;

    const stats = data?.response || [];

    const home = stats[0]?.statistics || [];
    const away = stats[1]?.statistics || [];

    const getStat = (arr: any[], name: string) => {
      return Number(arr.find(s => s.type === name)?.value || 0);
    };

    return {
      home: {
        shotsOnGoal: getStat(home, 'Shots on Goal'),
        shotsOffGoal: getStat(home, 'Shots off Goal'),
        possession: getStat(home, 'Ball Possession'),
        corners: getStat(home, 'Corner Kicks'),
        attacks: getStat(home, 'Total Shots'),
        dangerousAttacks: getStat(home, 'Dangerous Attacks'),
      },
      away: {
        shotsOnGoal: getStat(away, 'Shots on Goal'),
        shotsOffGoal: getStat(away, 'Shots off Goal'),
        possession: getStat(away, 'Ball Possession'),
        corners: getStat(away, 'Corner Kicks'),
        attacks: getStat(away, 'Total Shots'),
        dangerousAttacks: getStat(away, 'Dangerous Attacks'),
      }
    };

  } catch (err) {
    console.error('Erro STATS:', err);
    return null;
  }
  }
