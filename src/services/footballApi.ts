import { supabase } from '@/integrations/supabase/client';
import { MatchData } from '@/types/match';

// =============================
// CACHE INTELIGENTE
// =============================
let cachePre: MatchData[] = [];
let cacheLive: MatchData[] = [];

// =============================
// VALIDAÇÃO DE DADOS (ANTI ZERO)
// =============================
function isValidMatch(match: MatchData): boolean {
  if (!match) return false;

  // evita jogos sem métricas reais
  const m = match.metrics;

  const hasStats =
    m &&
    m.totalShots?.[0] + m.totalShots?.[1] > 0 &&
    m.possession?.[0] + m.possession?.[1] > 0;

  return hasStats;
}

// =============================
// PRÉ-JOGO (ROBUSTO)
// =============================
export async function fetchMatches(date: string): Promise<MatchData[]> {
  try {
    const { data, error } = await supabase.functions.invoke('football-api', {
      body: { date },
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    const raw =
      Array.isArray(data?.matches) ? data.matches :
      Array.isArray(data?.response) ? data.response :
      [];

    // 🔥 FILTRO PROFISSIONAL
    const result = raw.filter(isValidMatch);

    // ✅ atualiza cache só com dados bons
    if (result.length > 0) {
      cachePre = result;
      return result;
    }

    // ⚠️ fallback inteligente
    console.warn('Usando cache PRE (dados válidos)');
    return cachePre;

  } catch (err) {
    console.error('Erro PRE:', err);
    return cachePre;
  }
}

// =============================
// LIVE (NÍVEL TRADER)
// =============================
export async function fetchLiveMatches(): Promise<MatchData[]> {
  try {
    const { data, error } = await supabase.functions.invoke('football-api', {
      body: { live: true },
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    const raw =
      Array.isArray(data) ? data :
      Array.isArray(data?.matches) ? data.matches :
      Array.isArray(data?.response) ? data.response :
      [];

    // 🔥 FILTRO LIVE (MAIS FLEXÍVEL)
    const result = raw.filter((match: MatchData) => {
      if (!match) return false;

      // aceita live mesmo com menos dados
      if (match.isLive) return true;

      return isValidMatch(match);
    });

    // ✅ atualiza cache
    if (result.length > 0) {
      cacheLive = result;
      return result;
    }

    console.warn('Usando cache LIVE (dados válidos)');
    return cacheLive;

  } catch (err) {
    console.error('Erro LIVE:', err);
    return cacheLive;
  }
}
