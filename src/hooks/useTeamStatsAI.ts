// Busca estimativas de stats (médias últimos 5) via IA (Lovable AI Gateway).
// Usado como fallback quando não há fonte de dados de stats disponível.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { MatchData } from '@/types/match';

export interface AISideStats {
  possession: number;
  totalShots: number;
  shotsOnGoal: number;
  bigChances: number;
  corners: number;
  offsides: number;
  fouls: number;
  yellowCards: number;
  goalsFor: number;
  goalsAgainst: number;
}

interface AIStatsResponse {
  ok: boolean;
  source?: string;
  home: AISideStats;
  away: AISideStats;
}

export function useTeamStatsAI(match: MatchData | null | undefined, enabled = true) {
  const home = match?.homeTeam || '';
  const away = match?.awayTeam || '';
  const league = match?.league || '';

  const md = (match as any)?.modelData || {};
  const homeGoalsAvg = Number(md.homeGoalsAvg || 0);
  const awayGoalsAvg = Number(md.awayGoalsAvg || 0);
  const homeGoalsAgainstAvg = Number(md.homeGoalsAgainstAvg || 0);
  const awayGoalsAgainstAvg = Number(md.awayGoalsAgainstAvg || 0);

  // Já tem stats reais? não precisa de IA.
  const hs = (match as any)?.homeStats || {};
  const as_ = (match as any)?.awayStats || {};
  const hasRealStats = Number(hs.possession || 0) > 0
    || Number(hs.totalShots || 0) > 0
    || Number(as_.possession || 0) > 0
    || Number(as_.totalShots || 0) > 0;

  return useQuery<AIStatsResponse>({
    queryKey: ['team-stats-ai', home, away, homeGoalsAvg, awayGoalsAvg],
    enabled: enabled && Boolean(home && away) && !hasRealStats,
    staleTime: 1000 * 60 * 60 * 24,
    gcTime: 1000 * 60 * 60 * 24,
    retry: 0,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('team-stats-ai', {
        body: { home, away, league, homeGoalsAvg, awayGoalsAvg, homeGoalsAgainstAvg, awayGoalsAgainstAvg },
      });
      if (error || !data?.ok) {
        return { ok: false, home: {} as AISideStats, away: {} as AISideStats };
      }
      return data as AIStatsResponse;
    },
  });
}


export function mergeAIStatsIntoMatch(match: MatchData, ai?: AIStatsResponse | null): MatchData {
  if (!ai?.ok) return match;
  const hs = (match as any).homeStats || {};
  const as_ = (match as any).awayStats || {};
  const sample = (match as any).sampleSize || {};
  const pick = (cur: any, incoming: number) => {
    const c = Number(cur || 0);
    return c > 0 ? c : incoming;
  };
  const hasAiHome = Number(ai.home?.totalShots || 0) > 0 || Number(ai.home?.possession || 0) > 0;
  const hasAiAway = Number(ai.away?.totalShots || 0) > 0 || Number(ai.away?.possession || 0) > 0;
  return {
    ...match,
    sampleSize: {
      ...sample,
      homeGames: Number(sample.homeGames || 0) > 0 ? sample.homeGames : (hasAiHome ? 5 : 0),
      awayGames: Number(sample.awayGames || 0) > 0 ? sample.awayGames : (hasAiAway ? 5 : 0),
      homeWithStats: Number(sample.homeWithStats || 0) > 0 ? sample.homeWithStats : (hasAiHome ? 5 : 0),
      awayWithStats: Number(sample.awayWithStats || 0) > 0 ? sample.awayWithStats : (hasAiAway ? 5 : 0),
    },
    homeStats: {
      ...hs,
      possession: pick(hs.possession, ai.home.possession),
      totalShots: pick(hs.totalShots, ai.home.totalShots),
      shotsOnGoal: pick(hs.shotsOnGoal, ai.home.shotsOnGoal),
      bigChances: pick(hs.bigChances, ai.home.bigChances),
      corners: pick(hs.corners, ai.home.corners),
      offsides: pick(hs.offsides, ai.home.offsides),
      fouls: pick(hs.fouls, ai.home.fouls),
      yellowCards: pick(hs.yellowCards, ai.home.yellowCards),
      goalsFor: pick(hs.goalsFor, ai.home.goalsFor),
      goalsAgainst: pick(hs.goalsAgainst, ai.home.goalsAgainst),
    },
    awayStats: {
      ...as_,
      possession: pick(as_.possession, ai.away.possession),
      totalShots: pick(as_.totalShots, ai.away.totalShots),
      shotsOnGoal: pick(as_.shotsOnGoal, ai.away.shotsOnGoal),
      bigChances: pick(as_.bigChances, ai.away.bigChances),
      corners: pick(as_.corners, ai.away.corners),
      offsides: pick(as_.offsides, ai.away.offsides),
      fouls: pick(as_.fouls, ai.away.fouls),
      yellowCards: pick(as_.yellowCards, ai.away.yellowCards),
      goalsFor: pick(as_.goalsFor, ai.away.goalsFor),
      goalsAgainst: pick(as_.goalsAgainst, ai.away.goalsAgainst),
    },
    statsSource: ai.source || 'ai',
  } as MatchData;
}
