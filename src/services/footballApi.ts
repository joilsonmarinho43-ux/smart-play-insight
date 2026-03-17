import { supabase } from '@/integrations/supabase/client';
import { MatchData } from '@/types/match';

// =============================
// PRÉ-JOGO (MANTIDO ORIGINAL)
// =============================
export async function fetchMatches(date: string): Promise<MatchData[]> {
  const { data, error } = await supabase.functions.invoke('football-api', {
    body: { date },
  });

  if (error) {
    console.error('Error fetching matches:', error);
    throw new Error('Erro ao buscar jogos. Tente novamente.');
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return Array.isArray(data?.matches) ? data.matches : [];
}

// =============================
// LIVE (CORRIGIDO)
// =============================
export async function fetchLiveMatches(): Promise<MatchData[]> {
  const { data, error } = await supabase.functions.invoke('football-api', {
    body: { live: true }, // 🔥 PADRÃO CORRETO
  });

  if (error) {
    console.error('Error fetching live matches:', error);
    throw new Error('Erro ao buscar jogos ao vivo.');
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  // 🔥 BLINDAGEM TOTAL
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.matches)) return data.matches;
  if (Array.isArray(data?.response)) return data.response;

  return [];
}
