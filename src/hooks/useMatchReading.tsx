import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { MatchData } from "@/types/match";
import {
  buildMatchReadingV2,
  type MatchContext,
  type MatchReadingV2,
} from "@/lib/readingEngine";

export interface AnalystReading {
  cenario: string;
  pontoAtencao: string;
  veredito: string;
  risco: "baixo" | "medio" | "alto";
}

interface State {
  loading: boolean;
  reading: MatchReadingV2 | null;
  context: MatchContext | null;
  error: string | null;
  analyst: AnalystReading | null;
  analystLoading: boolean;
}

const memCache = new Map<string, { ts: number; ctx: MatchContext }>();
const analystCache = new Map<string, { ts: number; data: AnalystReading }>();
const TTL = 8 * 60 * 1000; // 8 min — alinhar com TTL do servidor para odds frescas
const ANALYST_TTL = 30 * 60 * 1000; // 30 min

export function useMatchReading(match: MatchData, enabled: boolean) {
  const [state, setState] = useState<State>({
    loading: false,
    reading: null,
    context: null,
    error: null,
    analyst: null,
    analystLoading: false,
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

      setState((s) => ({ ...s, loading: true, error: null, analyst: null }));

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
      if (cancel) return;

      // Detecta dados insuficientes: reading nulo OU qualidade "limitado"
      const dadosInsuficientes =
        !reading || reading.contextQuality === "limitado";

      setState({
        loading: false,
        reading,
        context: ctx,
        error: null,
        analyst: null,
        analystLoading: true, // sempre tentamos analyst (modo pesquisa se necessário)
      });

      // Camada de análise humana via Lovable AI
      const akey = String(fixtureId || `${match.homeTeam}-${match.awayTeam}`);
      const cachedA = analystCache.get(akey);
      if (cachedA && Date.now() - cachedA.ts < ANALYST_TTL) {
        if (!cancel)
          setState((s) => ({ ...s, analyst: cachedA.data, analystLoading: false }));
        return;
      }
      try {
        const { data, error } = await supabase.functions.invoke(
          "match-analyst",
          {
            body: {
              match: {
                id: fixtureId,
                homeTeam: match.homeTeam,
                awayTeam: match.awayTeam,
                league: match.league,
                time: match.time,
                matchProbabilities: (match as any).matchProbabilities ?? null,
                venue: m.fixture?.venue?.name ?? null,
                fixtureType: m.fixture?.round ?? null,
              },
              reading,
              context: ctx,
              pesquisaWeb: dadosInsuficientes,
            },
          },
        );
        if (cancel) return;
        if (!error && data && data.cenario && data.veredito) {
          const a: AnalystReading = {
            cenario: data.cenario,
            pontoAtencao: data.pontoAtencao,
            veredito: data.veredito,
            risco: data.risco || "medio",
          };
          analystCache.set(akey, { ts: Date.now(), data: a });
          setState((s) => ({ ...s, analyst: a, analystLoading: false }));
        } else {
          setState((s) => ({ ...s, analystLoading: false }));
        }
      } catch (e) {
        console.warn("match-analyst invoke fail", e);
        if (!cancel) setState((s) => ({ ...s, analystLoading: false }));
      }
    }

    run();
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, (match as any).fixture?.id || match.id]);

  return state;
}
