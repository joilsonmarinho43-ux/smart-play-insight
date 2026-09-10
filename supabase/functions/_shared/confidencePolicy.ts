// ════════════════════════════════════════════════════════════════
// confidencePolicy — política unificada por confidence_score
//   >= 85  : normal
//   70-84  : conservador (mais confluências, aviso)
//   50-69  : info_only (sem sinais)
//   < 50   : discard
// Usado por scanner-pro-server, auto-mode-server e Bingo (client).
// NÃO usado pelo Live Trader PRO (fora do escopo).
// ════════════════════════════════════════════════════════════════

export type ConfidenceMode = "normal" | "conservative" | "info_only" | "discard";

export interface ConfidencePolicy {
  mode: ConfidenceMode;
  allowSignals: boolean;
  conservative: boolean;
  label: string;
}

export function classifyConfidence(score: number | null | undefined): ConfidencePolicy {
  // Fail closed: ausência de score não pode autorizar sinal.
  const s = typeof score === "number" && Number.isFinite(score) ? score : 0;
  if (s >= 85) return { mode: "normal",       allowSignals: true,  conservative: false, label: "normal" };
  if (s >= 70) return { mode: "conservative", allowSignals: true,  conservative: true,  label: "conservador" };
  if (s >= 50) return { mode: "info_only",    allowSignals: false, conservative: false, label: "informativo" };
  return        { mode: "discard",            allowSignals: false, conservative: false, label: "descartado" };
}

/** Busca confidence_score chamando match-stats-resolver. Falha → score=0 (fail-closed). */
export async function resolveMatchConfidence(
  supabaseUrl: string,
  serviceRoleKey: string,
  payload: { matchId: string | number; homeTeam: string; awayTeam: string; league?: string | null; kickoffISO?: string | null },
  timeoutMs = 5000,
): Promise<{ score: number; source: string; ok: boolean }> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(`${supabaseUrl}/functions/v1/match-stats-resolver`, {
        method: "POST",
        headers: { Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      if (!r.ok) return { score: 0, source: "resolver_error", ok: false };
      const j = await r.json();
      const score = Number(j?.confidence_score);
      if (!Number.isFinite(score)) return { score: 0, source: "resolver_invalid", ok: false };
      return { score: Math.max(0, Math.min(100, score)), source: String(j?.source ?? "unknown"), ok: true };
    } finally {
      clearTimeout(t);
    }
  } catch {
    return { score: 0, source: "resolver_unreachable", ok: false };
  }
}

/** Logger curto e padronizado. */
export function logConfidenceDecision(tag: string, match: string, score: number, mode: ConfidenceMode, source: string) {
  if (mode === "normal") return;
  const icon = mode === "conservative" ? "🟡" : mode === "info_only" ? "🔵" : "🔴";
  console.log(`[${tag}][CONFIDENCE] ${icon} ${match} • score=${score} • mode=${mode} • source=${source}`);
}
