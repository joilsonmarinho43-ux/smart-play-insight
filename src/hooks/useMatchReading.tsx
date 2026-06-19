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
  contextoDetalhado?: {
    desfalques?: string;
    arbitro?: string;
    clima?: string;
    motivacao?: string;
  };
  mercados?: {
    vitoria?: string;
    duplaChance?: string;
    handicap?: string;
    overUnderGols?: string;
    btts?: string;
    escanteios?: string;
    cartoes?: string;
    placarExato?: string;
  };
  oddsReferencia?: {
    casa?: string;
    empate?: string;
    fora?: string;
    over25?: string;
    under25?: string;
    bttsSim?: string;
    escanteiosOver9?: string;
    cartoesOver4?: string;
  };
}

export interface FallbackStats {
  stats: Record<string, any>;
  source: string;
  confidence_score: number;
  lowConfidence: boolean;
  missing: string[];
}

interface State {
  loading: boolean;
  reading: MatchReadingV2 | null;
  context: MatchContext | null;
  error: string | null;
  analyst: AnalystReading | null;
  analystLoading: boolean;
  analystError: "rate_limited" | "credits_exhausted" | "ai_error" | "parse_fail" | null;
  fallback: FallbackStats | null;
}

const memCache = new Map<string, { ts: number; ctx: MatchContext }>();
const analystCache = new Map<string, { ts: number; data: AnalystReading }>();
const fallbackCache = new Map<string, { ts: number; data: FallbackStats }>();
const TTL = 8 * 60 * 1000;
const ANALYST_TTL = 30 * 60 * 1000;
const FALLBACK_TTL = 60 * 60 * 1000;

export function useMatchReading(match: MatchData, enabled: boolean) {
  const [state, setState] = useState<State>({
    loading: false,
    reading: null,
    context: null,
    error: null,
    analyst: null,
    analystLoading: false,
    fallback: null,
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

      // Pesquisa web SOMENTE quando não há reading (sem stats internas).
      // Se existe reading — mesmo com contextQuality "limitado" — preservamos
      // toda a leitura técnica enviando o payload completo ao analyst.
      const dadosInsuficientes = !reading;

      // Resolver fallback estatístico em paralelo (cache → DB → TheSportsDB → histórico)
      let fallback: FallbackStats | null = null;
      const fkey = String(fixtureId || `${match.homeTeam}-${match.awayTeam}`);
      const cachedF = fallbackCache.get(fkey);
      if (cachedF && Date.now() - cachedF.ts < FALLBACK_TTL) {
        fallback = cachedF.data;
      } else if (fixtureId || (match.homeTeam && match.awayTeam)) {
        try {
          const { data: fdata, error: ferror } = await supabase.functions.invoke(
            "match-stats-resolver",
            {
              body: {
                matchId: String(fixtureId || fkey),
                homeTeam: match.homeTeam,
                awayTeam: match.awayTeam,
                league: match.league,
                kickoffISO: m.fixture?.date,
              },
            },
          );
          if (!ferror && fdata && !fdata.error) {
            fallback = fdata as FallbackStats;
            fallbackCache.set(fkey, { ts: Date.now(), data: fallback });
          }
        } catch (e) {
          console.warn("match-stats-resolver invoke fail", e);
        }
      }
      if (cancel) return;

      setState({
        loading: false,
        reading,
        context: ctx,
        error: null,
        analyst: null,
        analystLoading: true, // sempre tentamos analyst (modo pesquisa se necessário)
        fallback,
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
              fallbackStats: fallback,
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
            contextoDetalhado: data.contextoDetalhado,
            mercados: data.mercados,
            oddsReferencia: data.oddsReferencia,
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
