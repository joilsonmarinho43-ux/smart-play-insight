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
    Number(match?.modelData?.homeGoalsAvg || 0) > 0 &&
    Number(match?.modelData?.awayGoalsAvg || 0) > 0
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
  const useForm = (current: any, incoming: number) => {
    const cur = Number(current || 0);
    return incoming > 0 && cur <= 0 ? incoming : current ?? incoming;
  };
  const sample = match.sampleSize;
  return {
    ...match,
    modelData: {
      ...md,
      homeGoalsAvg: useForm(md.homeGoalsAvg, h.goalsForAvg),
      awayGoalsAvg: useForm(md.awayGoalsAvg, a.goalsForAvg),
      homeGoalsAgainstAvg: useForm((md as any).homeGoalsAgainstAvg, h.goalsAgainstAvg),
      awayGoalsAgainstAvg: useForm((md as any).awayGoalsAgainstAvg, a.goalsAgainstAvg),
      homeCornersAvg: md.homeCornersAvg ?? null,
      awayCornersAvg: md.awayCornersAvg ?? null,
      homeCardsAvg: md.homeCardsAvg ?? null,
      awayCardsAvg: md.awayCardsAvg ?? null,
      homeCornersVariance: md.homeCornersVariance ?? null,
      awayCornersVariance: md.awayCornersVariance ?? null,
      homeCardsVariance: md.homeCardsVariance ?? null,
      awayCardsVariance: md.awayCardsVariance ?? null,
    },
    sampleSize: {
      homeGames: Math.max(sample?.homeGames || 0, h.games),
      awayGames: Math.max(sample?.awayGames || 0, a.games),
      homeWithStats: Math.max(sample?.homeWithStats || 0, h.games),
      awayWithStats: Math.max(sample?.awayWithStats || 0, a.games),
    },
    homeStats: { ...hs, goalsFor: useForm(hs.goalsFor, h.goalsForAvg), goalsAgainst: useForm(hs.goalsAgainst, h.goalsAgainstAvg), gamesCount: Math.max(hs.gamesCount || 0, h.games), recentGoalsFor: hs.recentGoalsFor?.length ? hs.recentGoalsFor : h.recentGoalsFor, recentGoalsAgainst: hs.recentGoalsAgainst?.length ? hs.recentGoalsAgainst : h.recentGoalsAgainst },
    awayStats: { ...as_, goalsFor: useForm(as_.goalsFor, a.goalsForAvg), goalsAgainst: useForm(as_.goalsAgainst, a.goalsAgainstAvg), gamesCount: Math.max(as_.gamesCount || 0, a.games), recentGoalsFor: as_.recentGoalsFor?.length ? as_.recentGoalsFor : a.recentGoalsFor, recentGoalsAgainst: as_.recentGoalsAgainst?.length ? as_.recentGoalsAgainst : a.recentGoalsAgainst },
  } as MatchData;
}
