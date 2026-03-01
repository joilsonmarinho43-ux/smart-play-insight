import { supabase } from '@/integrations/supabase/client';
import { MatchData } from '@/types/match';

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

  return data?.matches || [];
}
