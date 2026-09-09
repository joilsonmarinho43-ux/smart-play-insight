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

export interface ConfidenceResolution {
  score: number;
  source: string;
  diagnostic?: string;
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
    // Lazy-load the Supabase client so pure confidence classification/tests do not
    // require runtime Supabase environment variables just to import this module.
    const { supabase } = await import("@/integrations/supabase/client");
    const { data, error } = await supabase.functions.invoke("match-stats-resolver", { body: payload });

    if (error || !data) {
      console.error('[NEXUS-CONFIDENCE] resolver_error', {
        matchId: key,
        homeTeam: payload.homeTeam,
        awayTeam: payload.awayTeam,
        error: error?.message ?? 'NO_RESPONSE',
      });
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
    memCache.set(key, { ...out, ts: Date.now() });

    if (out.score === 0 || source === 'none') {
      console.warn('[NEXUS-CONFIDENCE] no usable confidence', {
        matchId: key,
        homeTeam: payload.homeTeam,
        awayTeam: payload.awayTeam,
        score: out.score,
        source: out.source,
        diagnostic: out.diagnostic ?? 'NONE',
      });
    }

    return out;
  } catch (error) {
    const diagnostic = error instanceof Error ? error.message : 'UNKNOWN';
    console.error('[NEXUS-CONFIDENCE] resolver_unreachable', {
      matchId: key,
      homeTeam: payload.homeTeam,
      awayTeam: payload.awayTeam,
      diagnostic,
    });
    return { score: 0, source: "resolver_unreachable", diagnostic };
  }
}

export function logConfidenceDecision(tag: string, match: string, score: number, mode: ConfidenceMode, source: string) {
  if (mode === "normal") return;
  const icon = mode === "conservative" ? "🟡" : mode === "info_only" ? "🔵" : "🔴";
  // eslint-disable-next-line no-console
  console.log(`[${tag}][CONFIDENCE] ${icon} ${match} • score=${score} • mode=${mode} • source=${source}`);
}
