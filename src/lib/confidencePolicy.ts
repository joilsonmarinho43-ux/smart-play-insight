// ════════════════════════════════════════════════════════════════
// confidencePolicy (client) — espelho da política do servidor.
//   >= 85  : normal
//   70-84  : conservador
//   50-69  : info_only
//   < 50   : discard
// ════════════════════════════════════════════════════════════════

export type ConfidenceMode = "normal" | "conservative" | "info_only" | "discard";

export interface ConfidencePolicy {
  mode: ConfidenceMode;
  allowSignals: boolean;
  conservative: boolean;
  label: string;
}

export function classifyConfidence(score: number | null | undefined): ConfidencePolicy {
  // Fail closed: ausência de score nunca pode virar confiança 100.
  const s = typeof score === "number" && Number.isFinite(score) ? score : 0;
  if (s >= 85) return { mode: "normal",       allowSignals: true,  conservative: false, label: "normal" };
  if (s >= 70) return { mode: "conservative", allowSignals: true,  conservative: true,  label: "conservador" };
  if (s >= 50) return { mode: "info_only",    allowSignals: false, conservative: false, label: "informativo" };
  return        { mode: "discard",            allowSignals: false, conservative: false, label: "descartado" };
}

interface CacheEntry { score: number; source: string; diagnostic?: string; ts: number; }
const memCache = new Map<string, CacheEntry>();
const TTL_MS = 10 * 60 * 1000; // 10 min
const EDGE_TIMEOUT_MS = 9000;

export interface ConfidenceResolution {
  score: number;
  source: string;
  diagnostic?: string;
}

/**
 * Invoca uma Edge Function com limite de tempo no cliente.
 * O Scanner nunca pode ficar indefinidamente aguardando um resolver externo.
 */
async function invokeWithTimeout<T = unknown>(
  invoke: () => Promise<{ data: T | null; error: { message?: string } | null }>,
  timeoutMs = EDGE_TIMEOUT_MS,
): Promise<{ data: T | null; error: { message?: string } | null }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      invoke(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`EDGE_FUNCTION_TIMEOUT:${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } catch (error) {
    return {
      data: null,
      error: { message: error instanceof Error ? error.message : 'EDGE_FUNCTION_ERROR' },
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Resolve confiança via edge function.
 * Falhas e ausência de dados permanecem fail-closed em score=0.
 *
 * Fallback auditado:
 * se o match-stats-resolver não encontrar provider, ou ficar abaixo do
 * limiar normal, usamos team-form somente para verificar se existe uma
 * amostra histórica independente suficientemente forte. A confiança do
 * fallback é derivada SOMENTE do tamanho da amostra histórica disponível;
 * não transforma gols em probabilidade.
 */
async function resolveFromTeamForm(homeTeam: string, awayTeam: string): Promise<ConfidenceResolution | null> {
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data, error } = await invokeWithTimeout(() => supabase.functions.invoke("team-form", {
      body: { home: homeTeam, away: awayTeam },
    }));
    if (error || !data || !(data as any).ok) return null;

    const home = (data as any).home as any;
    const away = (data as any).away as any;
    const homeGames = Number(home?.games ?? 0);
    const awayGames = Number(away?.games ?? 0);
    const homeGoals = Number(home?.goalsForAvg ?? 0);
    const awayGoals = Number(away?.goalsForAvg ?? 0);

    if (!Number.isFinite(homeGames) || !Number.isFinite(awayGames) || homeGames < 3 || awayGames < 3) {
      return null;
    }
    if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals) || homeGoals <= 0 || awayGoals <= 0) {
      return null;
    }

    // 5+ jogos reais de cada lado = amostra mínima para o modo normal.
    // 3-4 jogos = conservador; nunca é promovido para SIGNAL.
    const score = homeGames >= 5 && awayGames >= 5 ? 85 : 75;
    const diagnostic = `TEAM_FORM_SAMPLE:${homeGames}x${awayGames}`;

    return {
      score,
      source: "team-form-historical",
      diagnostic,
    };
  } catch (error) {
    console.warn("[NEXUS-CONFIDENCE] team-form fallback failed", error);
    return null;
  }
}

/**
 * Resolve confiança via edge function.
 * Falhas e ausência de dados permanecem fail-closed em score=0, mas a causa
 * é preservada para diagnóstico operacional do Scanner.
 */
export async function resolveConfidence(payload: {
  matchId: string | number; homeTeam: string; awayTeam: string;
  league?: string | null; kickoffISO?: string | null;
}): Promise<ConfidenceResolution> {
  const key = String(payload.matchId);
  const cached = memCache.get(key);
  if (cached && Date.now() - cached.ts < TTL_MS) {
    return { score: cached.score, source: cached.source, diagnostic: cached.diagnostic };
  }

  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data, error } = await invokeWithTimeout(() => supabase.functions.invoke("match-stats-resolver", { body: payload }));

    if (error || !data) {
      console.error('[NEXUS-CONFIDENCE] resolver_error', {
        matchId: key,
        homeTeam: payload.homeTeam,
        awayTeam: payload.awayTeam,
        error: error?.message ?? 'NO_RESPONSE',
      });

      const fallback = await resolveFromTeamForm(payload.homeTeam, payload.awayTeam);
      if (fallback) {
        memCache.set(key, { ...fallback, ts: Date.now() });
        return fallback;
      }
      return { score: 0, source: "resolver_error", diagnostic: error?.message ?? 'NO_RESPONSE' };
    }

    const rawScore = Number((data as any).confidence_score);
    const source = String((data as any).source ?? "unknown");
    const diagnostic = typeof (data as any).diagnostic === 'string'
      ? String((data as any).diagnostic)
      : undefined;

    if (!Number.isFinite(rawScore)) {
      console.error('[NEXUS-CONFIDENCE] resolver_invalid', {
        matchId: key,
        homeTeam: payload.homeTeam,
        awayTeam: payload.awayTeam,
        source,
        diagnostic,
      });
      return { score: 0, source: "resolver_invalid", diagnostic: diagnostic ?? 'INVALID_CONFIDENCE_SCORE' };
    }

    const out: ConfidenceResolution = {
      score: Math.max(0, Math.min(100, rawScore)),
      source,
      diagnostic,
    };

    // Uma fonte secundária não pode reduzir nem inflar artificialmente a
    // confiança. Para scores abaixo de 85, consultamos o histórico auditado
    // apenas para verificar se há uma amostra independente forte o bastante
    // para atingir legitimamente o limiar normal.
    if (out.score < 85) {
      const fallback = await resolveFromTeamForm(payload.homeTeam, payload.awayTeam);
      if (fallback && fallback.score > out.score) {
        memCache.set(key, { ...fallback, ts: Date.now() });
        console.info('[NEXUS-CONFIDENCE] historical fallback improved', {
          matchId: key,
          homeTeam: payload.homeTeam,
          awayTeam: payload.awayTeam,
          primaryScore: out.score,
          primarySource: out.source,
          fallbackScore: fallback.score,
          fallbackSource: fallback.source,
          diagnostic: fallback.diagnostic,
        });
        return fallback;
      }
    }

    memCache.set(key, { ...out, ts: Date.now() });
    return out;
  } catch (error) {
    const diagnostic = error instanceof Error ? error.message : 'UNKNOWN';
    console.error('[NEXUS-CONFIDENCE] resolver_unreachable', {
      matchId: key,
      homeTeam: payload.homeTeam,
      awayTeam: payload.awayTeam,
      diagnostic,
    });

    const fallback = await resolveFromTeamForm(payload.homeTeam, payload.awayTeam);
    if (fallback) {
      memCache.set(key, { ...fallback, ts: Date.now() });
      return fallback;
    }

    return { score: 0, source: "resolver_unreachable", diagnostic };
  }
}

export function logConfidenceDecision(tag: string, match: string, score: number, mode: ConfidenceMode, source: string) {
  if (mode === "normal") return;
  const icon = mode === "conservative" ? "🟡" : mode === "info_only" ? "🔵" : "🔴";
  // eslint-disable-next-line no-console
  console.log(`[${tag}][CONFIDENCE] ${icon} ${match} • score=${score} • mode=${mode} • source=${source}`);
}
