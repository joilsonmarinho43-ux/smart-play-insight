// Superbet Connect — Nível 4: enriquecimento via SportsRC v2.
// Quando o parser (URL/texto/OCR/Vision) ainda não tem times+placar+status,
// procuramos o jogo no SportsRC pela data atual e nomes dos times.
// Não substitui odds da Superbet — só preenche o que ainda está faltando.

const SPORTSRC_KEY = Deno.env.get("SPORTSRC_API_KEY") || "";
const BASE = "https://api.sportsrc.org/v2";

function strip(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function similarity(a: string, b: string): number {
  const x = strip(a), y = strip(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.85;
  const tx = new Set(x.split(/\s+/));
  const ty = new Set(y.split(/\s+/));
  let common = 0;
  for (const t of tx) if (ty.has(t)) common++;
  return common / Math.max(tx.size, ty.size);
}

async function fetchMatchesByDate(date: string): Promise<any[]> {
  if (!SPORTSRC_KEY) return [];
  const url = new URL(BASE + "/");
  url.searchParams.set("type", "matches");
  url.searchParams.set("date", date);
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url.toString(), {
      headers: { "Accept": "application/json", "X-API-KEY": SPORTSRC_KEY },
      signal: ctrl.signal,
    });
    if (!res.ok) return [];
    const json = await res.json().catch(() => null);
    const groups: any[] = Array.isArray(json?.data) ? json.data : [];
    const out: any[] = [];
    for (const g of groups) {
      const league = g?.league || null;
      for (const m of (g?.matches ?? [])) out.push({ ...m, _league: league });
    }
    return out;
  } catch {
    return [];
  } finally {
    clearTimeout(to);
  }
}

export interface SportsRCEnrichment {
  matched: boolean;
  fieldsFilled: string[];
  data?: {
    home?: string;
    away?: string;
    league?: string;
    status?: string;
    isLive?: boolean;
    score?: string;
    minute?: number;
    matchId?: string;
  };
  note?: string;
}

export async function enrichFromSportsRC(opts: {
  home?: string;
  away?: string;
  todayIso?: string; // YYYY-MM-DD
}): Promise<SportsRCEnrichment> {
  if (!SPORTSRC_KEY) {
    return { matched: false, fieldsFilled: [], note: "sportsrc_no_key" };
  }
  if (!opts.home || !opts.away) {
    return { matched: false, fieldsFilled: [], note: "sportsrc_missing_teams" };
  }

  // tenta hoje e ontem (jogos do início da madrugada)
  const today = opts.todayIso || new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const candidates = [...(await fetchMatchesByDate(today)), ...(await fetchMatchesByDate(yesterday))];
  if (candidates.length === 0) return { matched: false, fieldsFilled: [], note: "sportsrc_empty" };

  let best: any = null;
  let bestScore = 0;
  for (const m of candidates) {
    const h = m?.teams?.home?.name ?? "";
    const a = m?.teams?.away?.name ?? "";
    const s = (similarity(h, opts.home) + similarity(a, opts.away)) / 2;
    if (s > bestScore) { bestScore = s; best = m; }
  }
  if (!best || bestScore < 0.55) {
    return { matched: false, fieldsFilled: [], note: `sportsrc_no_match (best=${bestScore.toFixed(2)})` };
  }

  const status = String(best?.status ?? "").toLowerCase();
  const LIVE = new Set(["live", "inprogress", "in_progress", "1h", "2h", "ht", "halftime"]);
  const sc = best?.score?.current ?? {};
  const minute = typeof best?.minute === "number" ? best.minute
    : typeof best?.time?.minute === "number" ? best.time.minute
    : undefined;

  const data = {
    home: best?.teams?.home?.name,
    away: best?.teams?.away?.name,
    league: best?._league?.name,
    status: best?.status_detail || best?.status,
    isLive: LIVE.has(status),
    score: typeof sc.home === "number" && typeof sc.away === "number" ? `${sc.home}-${sc.away}` : undefined,
    minute,
    matchId: best?.id != null ? String(best.id) : undefined,
  };

  const fieldsFilled: string[] = [];
  if (data.home && data.away) fieldsFilled.push("teams");
  if (data.league) fieldsFilled.push("league");
  if (data.score) fieldsFilled.push("score");
  if (data.minute) fieldsFilled.push("minute");
  if (data.status) fieldsFilled.push("status");

  return { matched: true, fieldsFilled, data, note: `sportsrc_match (score=${bestScore.toFixed(2)})` };
}
