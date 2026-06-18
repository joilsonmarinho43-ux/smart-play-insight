// ════════════════════════════════════════════════════════════════
// confidencePolicy (client) — espelho da política do servidor.
//   >= 85  : normal
//   70-84  : conservador
//   50-69  : info_only
//   < 50   : discard
// ════════════════════════════════════════════════════════════════
import { supabase } from "@/integrations/supabase/client";

export type ConfidenceMode = "normal" | "conservative" | "info_only" | "discard";

export interface ConfidencePolicy {
  mode: ConfidenceMode;
  allowSignals: boolean;
  conservative: boolean;
  label: string;
}

export function classifyConfidence(score: number | null | undefined): ConfidencePolicy {
  const s = typeof score === "number" ? score : 100;
  if (s >= 85) return { mode: "normal",       allowSignals: true,  conservative: false, label: "normal" };
  if (s >= 70) return { mode: "conservative", allowSignals: true,  conservative: true,  label: "conservador" };
  if (s >= 50) return { mode: "info_only",    allowSignals: false, conservative: false, label: "informativo" };
  return        { mode: "discard",      allowSignals: false, conservative: false, label: "descartado" };
}

interface CacheEntry { score: number; source: string; ts: number; }
const memCache = new Map<string, CacheEntry>();
const TTL_MS = 10 * 60 * 1000; // 10 min

/** Resolve confiança via edge function. Falha silenciosa → score=100. */
export async function resolveConfidence(payload: {
  matchId: string | number; homeTeam: string; awayTeam: string;
  league?: string | null; kickoffISO?: string | null;
}): Promise<{ score: number; source: string }> {
  const key = String(payload.matchId);
  const cached = memCache.get(key);
  if (cached && Date.now() - cached.ts < TTL_MS) return { score: cached.score, source: cached.source };
  try {
    const { data, error } = await supabase.functions.invoke("match-stats-resolver", { body: payload });
    if (error || !data) return { score: 100, source: "resolver_error" };
    const out = { score: Number((data as any).confidence_score ?? 100), source: String((data as any).source ?? "unknown") };
    memCache.set(key, { ...out, ts: Date.now() });
    return out;
  } catch {
    return { score: 100, source: "resolver_unreachable" };
  }
}

export function logConfidenceDecision(tag: string, match: string, score: number, mode: ConfidenceMode, source: string) {
  if (mode === "normal") return;
  const icon = mode === "conservative" ? "🟡" : mode === "info_only" ? "🔵" : "🔴";
  // eslint-disable-next-line no-console
  console.log(`[${tag}][CONFIDENCE] ${icon} ${match} • score=${score} • mode=${mode} • source=${source}`);
}
