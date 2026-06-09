// Registro de fontes de dados. Importado uma vez no bootstrap.
// Adicionar novas fontes aqui (RapidAPI, SportMonks, TheSportsDB, etc.)
// sem tocar no resto do app.

import { MatchData } from '@/types/match';
import { registerSource } from './index';
import { fetchMatches } from '../footballApi';

// =====================================================================
// FONTE 1 (PRIMÁRIA): Edge Function football-api
// Já implementa retry, cache 24h e fallback offline para stale-cache.
// =====================================================================
registerSource({
  name: 'football-api-edge',
  priority: 1,
  fetchByDate: async (date: string): Promise<MatchData[]> => {
    return await fetchMatches(date);
  },
});

// =====================================================================
// FONTE 2 (CACHE EXPIRADO): rede de segurança final.
// Se a fonte 1 retornou [] (ex.: API caiu E cache vazio), tentamos
// reler qualquer cache antigo ainda em localStorage para essa data.
// =====================================================================
registerSource({
  name: 'stale-local-cache',
  priority: 99,
  fetchByDate: async (date: string): Promise<MatchData[]> => {
    try {
      const raw = localStorage.getItem(`football_cache_pre_${date}`);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  },
});

// =====================================================================
// Espaço reservado para fontes plugáveis futuras (todas opcionais).
//
// Exemplo (descomente quando configurar a edge function correspondente):
//
// import { supabase } from '@/integrations/supabase/client';
// registerSource({
//   name: 'rapidapi-football',
//   priority: 2,
//   isAvailable: async () => {
//     // Idealmente checa via uma edge function se a chave foi configurada
//     return true;
//   },
//   fetchByDate: async (date) => {
//     const { data } = await supabase.functions.invoke('football-api-rapid', { body: { date } });
//     return Array.isArray(data?.matches) ? data.matches : [];
//   },
// });
// =====================================================================
