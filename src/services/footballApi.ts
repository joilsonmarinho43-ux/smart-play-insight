import { supabase } from '@/integrations/supabase/client';
import { MatchData } from '@/types/match';

// =============================
// CACHE SIMPLES (MEMÓRIA)
// =============================
let cachePre: MatchData[] = [];
let cacheLive: MatchData[] = [];

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

    const result =
      Array.isArray(data?.matches) ? data.matches :
      Array.isArray(data?.response) ? data.response :
      [];

    // ✅ salva cache se vier algo válido
    if (result.length > 0) {
      cachePre = result;
      return result;
    }

    // ⚠️ fallback
    console.warn('Usando cache PRE');
    return cachePre;

  } catch (err) {
    console.error('Erro PRE:', err);
    return cachePre;
  }
}

// =============================
// LIVE (ESTÁVEL)
// =============================
export async function fetchLiveMatches(): Promise<MatchData[]> {
  try {
    const { data, error } = await supabase.functions.invoke('football-api', {
      body: { live: true },
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    const result =
      Array.isArray(data) ? data :
      Array.isArray(data?.matches) ? data.matches :
      Array.isArray(data?.response) ? data.response :
      [];

    // ✅ atualiza só se vier dado real
    if (result.length > 0) {
      cacheLive = result;
      return result;
    }

    // ⚠️ fallback LIVE
    console.warn('Usando cache LIVE');
    return cacheLive;

  } catch (err) {
    console.error('Erro LIVE:', err);
    return cacheLive;
  }
      }
