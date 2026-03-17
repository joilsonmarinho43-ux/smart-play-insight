import { supabase } from '@/integrations/supabase/client';
import { MatchData } from '@/types/match';

// Mantém o funcionamento do Pré-jogo original
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

// Nova função para o Painel de Trade Ao Vivo
export async function fetchLiveMatches(): Promise<MatchData[]> {
  const { data, error } = await supabase.functions.invoke('football-api', {
    body: { mode: 'live' }, // Instrução para o backend ativar modo Live
  });

  if (error) {
    console.error('Error fetching live matches:', error);
    throw new Error('Erro ao buscar jogos ao vivo.');
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return data?.matches || [];
}
