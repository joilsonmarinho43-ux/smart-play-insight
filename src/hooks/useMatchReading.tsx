import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { MatchData } from "@/types/match";
import {
  buildMatchReadingV2,
  type MatchContext,
  type MatchReadingV2,
} from "@/lib/readingEngine";

interface State {
  loading: boolean;
  reading: MatchReadingV2 | null;
  context: MatchContext | null;
  error: string | null;
}

const memCache = new Map<string, { ts: number; ctx: MatchContext }>();
const TTL = 30 * 60 * 1000;

export function useMatchReading(match: MatchData, enabled: boolean) {
  const [state, setState] = useState<State>({
    loading: false,
    reading: null,
    context: null,
    error: null,
  });

  useEffect(() => {
    if (!enabled) return;
    let cancel = false;

    async function run() {
      const m: any = match;
      const fixtureId = m.fixture?.id || (typeof m.id === "number" ? m.id : null);
      const leagueId = m.league?.id || m.leagueId;
      const season = m.league?.season || m.season;
      const homeId = m.teams?.home?.id || m.homeId;
      const awayId = m.teams?.away?.id || m.awayId;

      setState((s) => ({ ...s, loading: true, error: null }));

      let ctx: MatchContext | null = null;
      if (fixtureId) {
        const key = String(fixtureId);
        const cached = memCache.get(key);
        if (cached && Date.now() - cached.ts < TTL) {
          ctx = cached.ctx;
        } else {
          try {
            const { data, error } = await supabase.functions.invoke(
              "match-context",
              {
                body: {
                  fixtureId,
                  leagueId,
                  season,
                  homeId,
                  awayId,
                  homeName: match.homeTeam,
                  awayName: match.awayTeam,
                  kickoffISO: m.fixture?.date,
                },
              },
            );
            if (!error && data) {
              ctx = data as MatchContext;
              memCache.set(key, { ts: Date.now(), ctx });
            }
          } catch (e) {
            console.warn("match-context invoke fail", e);
          }
        }
      }

      const reading = buildMatchReadingV2(match, ctx);
      if (!cancel)
        setState({ loading: false, reading, context: ctx, error: null });
    }

    run();
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, (match as any).fixture?.id || match.id]);

  return state;
}
