import { supabase } from '@/integrations/supabase/client';
import { MatchData } from '@/types/match';

// =============================
// CACHE COM TIMESTAMPS (CONTROLE RIGOROSO)
// =============================
let cachePre: MatchData[] = [];
let lastFetchPre = 0;

let cacheLive: MatchData[] = [];
let lastFetchLive = 0;

// Configurações de tempo (em milissegundos)
const PRE_MATCH_COOLDOWN = 1000 * 60 * 2; // 2 minutos para Pré-jogo
const LIVE_MATCH_COOLDOWN = 1000 * 30;    // 30 segundos para Live

// =============================
// VALIDAÇÃO DE DADOS (ANTI ZERO)
// =============================
function isValidMatch(match: MatchData): boolean {
  if (!match) return false;
  const m = match.metrics;
  const hasStats =
    m &&
    (m.totalShots?.[0] || 0) + (m.totalShots?.[1] || 0) > 0 &&
    (m.possession?.[0] || 0) + (m.possession?.[1] || 0) > 0;
  return hasStats;
}

// =============================
// PRÉ-JOGO (COM TRAVA DE SEGURANÇA)
// =============================
export async function fetchMatches(date: string): Promise<MatchData[]> {
  const now = Date.now();
  
  // 🛡️ TRAVA: Se buscou há menos de 2 min, retorna o cache e economiza API
  if (cachePre.length > 0 && (now - lastFetchPre < PRE_MATCH_COOLDOWN)) {
    console.log('🛡️ Bloqueio de segurança: Usando cache Pré-Jogo para economizar API.');
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
      lastFetchPre = now; // Atualiza o cronômetro da última busca
      return result;
    }

    return cachePre;
  } catch (err) {
    console.error('Erro PRE:', err);
    return cachePre;
  }
}

// =============================
// LIVE (NÍVEL TRADER - COM TRAVA)
// =============================
export async function fetchLiveMatches(): Promise<MatchData[]> {
  const now = Date.now();

  // 🛡️ TRAVA: Se buscou há menos de 30 seg, não chama a função do Supabase
  if (cacheLive.length > 0 && (now - lastFetchLive < LIVE_MATCH_COOLDOWN)) {
    console.log('🛡️ Bloqueio de segurança: Usando cache Live para economizar API.');
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

    const result = raw.filter((match: MatchData) => {
      if (!match) return false;
      if (match.isLive) return true;
      return isValidMatch(match);
    });

    if (result.length > 0) {
      cacheLive = result;
      lastFetchLive = now; // Atualiza o cronômetro da última busca
      return result;
    }

    return cacheLive;
  } catch (err) {
    console.error('Erro LIVE:', err);
    return cacheLive;
  }
        }
      
