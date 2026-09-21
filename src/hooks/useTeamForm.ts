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
  stats?: {
    possession?: number | null; xG?: number | null; totalShots?: number | null;
    shotsOnGoal?: number | null; bigChances?: number | null; corners?: number | null;
    offsides?: number | null; fouls?: number | null; yellowCards?: number | null;
  };
}

interface TeamFormResponse {
  ok: boolean;
  home: SideForm;
  away: SideForm;
}

const empty: SideForm = { games: 0, goalsForAvg: 0, goalsAgainstAvg: 0, recentGoalsFor: [], recentGoalsAgainst: [], stats: {} };

export function useTeamForm(match: MatchData | null | undefined, active = true) {
  const home = match?.homeTeam || '';
  const away = match?.awayTeam || '';
  const enabled = Boolean(home && away);

  // Só pula a busca se a partida já tem médias E amostra de jogos conhecida
  const sample = match?.sampleSize;
  const hasSample = Number(sample?.homeGames || 0) > 0 && Number(sample?.awayGames || 0) > 0;
  const alreadyHas = Boolean(
    Number(match?.modelData?.homeGoalsAvg || 0) > 0 &&
    Number(match?.modelData?.awayGoalsAvg || 0) > 0 &&
    hasSample
  );

  return useQuery<TeamFormResponse>({
    queryKey: ['team-form', home, away],
    enabled: active && enabled && !alreadyHas,
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
  const hStats = h.stats || {};
  const aStats = a.stats || {};
  const stat = (current: any, incoming: any) => Number.isFinite(Number(incoming)) ? (Number.isFinite(Number(current)) ? current : Number(incoming)) : current ?? null;
  const hs = (match as any).homeStats || {};
  const as_ = (match as any).awayStats || {};
  const useForm = (current: any, incoming: number) => {
    const cur = Number(current || 0);
    return incoming > 0 && cur <= 0 ? incoming : current ?? incoming;
  };
  const sample = match.sampleSize;
  const historicalSample = Math.min(Number(h.games || 0), Number(a.games || 0));
  const modelQuality = historicalSample >= 5 ? 'VALID' : historicalSample >= 3 ? 'PARTIAL' : 'INSUFFICIENT';
  return {
    ...match,
    modelData: {
      ...md,
      source: md.source || 'team-form:ESPN/TSDB',
      historicalSample: Math.max(Number(md.historicalSample || 0), historicalSample),
      dataQuality: md.dataQuality === 'VALID' || modelQuality === 'VALID' ? 'VALID' : modelQuality,
      homeGoalsAvg: useForm(md.homeGoalsAvg, h.goalsForAvg),
      awayGoalsAvg: useForm(md.awayGoalsAvg, a.goalsForAvg),
      homeGoalsAgainstAvg: useForm((md as any).homeGoalsAgainstAvg, h.goalsAgainstAvg),
      awayGoalsAgainstAvg: useForm((md as any).awayGoalsAgainstAvg, a.goalsAgainstAvg),
      homeCornersAvg: stat(md.homeCornersAvg, hStats.corners),
      awayCornersAvg: stat(md.awayCornersAvg, aStats.corners),
      homeCardsAvg: stat(md.homeCardsAvg, hStats.yellowCards),
      awayCardsAvg: stat(md.awayCardsAvg, aStats.yellowCards),
      homePossessionAvg: stat((md as any).homePossessionAvg, hStats.possession),
      awayPossessionAvg: stat((md as any).awayPossessionAvg, aStats.possession),
      homeXGAvg: stat((md as any).homeXGAvg, hStats.xG),
      awayXGAvg: stat((md as any).awayXGAvg, aStats.xG),
      homeTotalShotsAvg: stat((md as any).homeTotalShotsAvg, hStats.totalShots),
      awayTotalShotsAvg: stat((md as any).awayTotalShotsAvg, aStats.totalShots),
      homeShotsOnGoalAvg: stat((md as any).homeShotsOnGoalAvg, hStats.shotsOnGoal),
      awayShotsOnGoalAvg: stat((md as any).awayShotsOnGoalAvg, aStats.shotsOnGoal),
      homeBigChancesAvg: stat((md as any).homeBigChancesAvg, hStats.bigChances),
      awayBigChancesAvg: stat((md as any).awayBigChancesAvg, aStats.bigChances),
      homeOffsidesAvg: stat((md as any).homeOffsidesAvg, hStats.offsides),
      awayOffsidesAvg: stat((md as any).awayOffsidesAvg, aStats.offsides),
      homeFoulsAvg: stat((md as any).homeFoulsAvg, hStats.fouls),
      awayFoulsAvg: stat((md as any).awayFoulsAvg, aStats.fouls),
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
    homeStats: { ...hs, goalsFor: useForm(hs.goalsFor, h.goalsForAvg), goalsAgainst: useForm(hs.goalsAgainst, h.goalsAgainstAvg), gamesCount: Math.max(hs.gamesCount || 0, h.games), recentGoalsFor: hs.recentGoalsFor?.length ? hs.recentGoalsFor : h.recentGoalsFor, recentGoalsAgainst: hs.recentGoalsAgainst?.length ? hs.recentGoalsAgainst : h.recentGoalsAgainst, possession: stat(hs.possession,hStats.possession), xG: stat(hs.xG,hStats.xG), totalShots: stat(hs.totalShots,hStats.totalShots), shotsOnGoal: stat(hs.shotsOnGoal,hStats.shotsOnGoal), bigChances: stat(hs.bigChances,hStats.bigChances), corners: stat(hs.corners,hStats.corners), offsides: stat(hs.offsides,hStats.offsides), fouls: stat(hs.fouls,hStats.fouls), yellowCards: stat(hs.yellowCards,hStats.yellowCards) },
    awayStats: { ...as_, goalsFor: useForm(as_.goalsFor, a.goalsForAvg), goalsAgainst: useForm(as_.goalsAgainst, a.goalsAgainstAvg), gamesCount: Math.max(as_.gamesCount || 0, a.games), recentGoalsFor: as_.recentGoalsFor?.length ? as_.recentGoalsFor : a.recentGoalsFor, recentGoalsAgainst: as_.recentGoalsAgainst?.length ? as_.recentGoalsAgainst : a.recentGoalsAgainst, possession: stat(as_.possession,aStats.possession), xG: stat(as_.xG,aStats.xG), totalShots: stat(as_.totalShots,aStats.totalShots), shotsOnGoal: stat(as_.shotsOnGoal,aStats.shotsOnGoal), bigChances: stat(as_.bigChances,aStats.bigChances), corners: stat(as_.corners,aStats.corners), offsides: stat(as_.offsides,aStats.offsides), fouls: stat(as_.fouls,aStats.fouls), yellowCards: stat(as_.yellowCards,aStats.yellowCards) },
  } as MatchData;
}
