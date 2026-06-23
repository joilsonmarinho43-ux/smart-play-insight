// Hook que busca os últimos 5 jogos (TheSportsDB) via edge function `team-form`
// e enriquece `modelData`/`sampleSize`/`homeStats.recentGoalsFor` da partida
// quando a fonte de fixture (SportsRC/FDO/TSDB) não trouxe stats avançados.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { MatchData } from '@/types/match';

interface SideForm {
  games: number;
  goalsForAvg: number;
  goalsAgainstAvg: number;
  recentGoalsFor: number[];
  recentGoalsAgainst: number[];
}

interface TeamFormResponse {
  ok: boolean;
  home: SideForm;
  away: SideForm;
}

const empty: SideForm = { games: 0, goalsForAvg: 0, goalsAgainstAvg: 0, recentGoalsFor: [], recentGoalsAgainst: [] };

export function useTeamForm(match: MatchData | null | undefined) {
  const home = match?.homeTeam || '';
  const away = match?.awayTeam || '';
  const enabled = Boolean(home && away);

  // Só busca se a partida ainda não tem modelData populado
  const alreadyHas = Boolean(
    match?.modelData?.homeGoalsAvg && match?.modelData?.awayGoalsAvg
  );

  return useQuery<TeamFormResponse>({
    queryKey: ['team-form', home, away],
    enabled: enabled && !alreadyHas,
    staleTime: 1000 * 60 * 60 * 12, // 12h
    gcTime: 1000 * 60 * 60 * 24,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('team-form', {
        body: { home, away },
      });
      if (error || !data?.ok) return { ok: false, home: empty, away: empty } as TeamFormResponse;
      return data as TeamFormResponse;
    },
  });
}

/** Mescla o resultado de useTeamForm em uma MatchData (não muta original). */
export function mergeFormIntoMatch(match: MatchData, form?: TeamFormResponse | null): MatchData {
  if (!form?.ok) return match;
  const h = form.home || empty;
  const a = form.away || empty;
  const md = match.modelData || ({} as any);
  const hs = (match as any).homeStats || {};
  const as_ = (match as any).awayStats || {};
  return {
    ...match,
    modelData: {
      ...md,
      homeGoalsAvg: md.homeGoalsAvg ?? h.goalsForAvg,
      awayGoalsAvg: md.awayGoalsAvg ?? a.goalsForAvg,
      homeGoalsAgainstAvg: (md as any).homeGoalsAgainstAvg ?? h.goalsAgainstAvg,
      awayGoalsAgainstAvg: (md as any).awayGoalsAgainstAvg ?? a.goalsAgainstAvg,
      homeCornersAvg: md.homeCornersAvg ?? null,
      awayCornersAvg: md.awayCornersAvg ?? null,
      homeCardsAvg: md.homeCardsAvg ?? null,
      awayCardsAvg: md.awayCardsAvg ?? null,
      homeCornersVariance: md.homeCornersVariance ?? null,
      awayCornersVariance: md.awayCornersVariance ?? null,
      homeCardsVariance: md.homeCardsVariance ?? null,
      awayCardsVariance: md.awayCardsVariance ?? null,
    },
    sampleSize: match.sampleSize ?? {
      homeGames: h.games,
      awayGames: a.games,
      homeWithStats: h.games,
      awayWithStats: a.games,
    },
    homeStats: { ...hs, recentGoalsFor: hs.recentGoalsFor?.length ? hs.recentGoalsFor : h.recentGoalsFor },
    awayStats: { ...as_, recentGoalsFor: as_.recentGoalsFor?.length ? as_.recentGoalsFor : a.recentGoalsFor },
  } as MatchData;
}
