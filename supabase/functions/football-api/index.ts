/* Nexus 33 football-api: source normalization and provenance only. */
const SPORTSRC_KEY = Deno.env.get("SPORTSRC_API_KEY") || "";
const SPORTSRC_BASE = "https://api.sportsrc.org/v2";
const LIVE_STATUSES = new Set(["1H", "2H", "HT", "ET", "P"]);

export interface SourceDiag { source: string; status: number; ms: number; matches: number; error?: string; skipped?: string; }

function normalizeStatus(raw: unknown): string {
  const s = String(raw ?? "").toUpperCase().replace(/[\s_-]+/g, "");
  if (["FINISHED", "ENDED", "FT", "FULLTIME", "FULL-TIME"].includes(s)) return "FT";
  if (["CANCELED", "CANCELLED", "POSTPONED", "PST"].includes(s)) return "CANC";
  if (["NOTSTARTED", "NS", "SCHEDULED", "TBD"].includes(s)) return "NS";
  if (["HALFTIME", "HT"].includes(s)) return "HT";
  if (["2H", "2NDHALF", "SECONDHALF"].includes(s)) return "2H";
  if (["1H", "1STHALF", "FIRSTHALF", "INPROGRESS", "LIVE", "PLAYING"].includes(s)) return "1H";
  if (s.includes("PENALTY")) return "P";
  if (s.includes("EXTRA")) return "ET";
  return s || "UNKNOWN";
}

function timestampMs(m: any): number | null {
  const raw = m?.timestamp ?? m?.fixture?.timestamp;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return null;
  return raw < 1e12 ? raw * 1000 : raw;
}

/**
 * Derives elapsed minutes only when the upstream provides a trustworthy
 * minute. We deliberately do NOT infer minutes from wall-clock time: kickoff
 * timestamps do not encode halftime, stoppage time, delays or interruptions.
 */
function elapsedFromUpstream(m: any, status: string): number | null {
  const candidates = [m?.minute, m?.elapsed, m?.fixture?.status?.elapsed, m?.status?.elapsed];
  for (const value of candidates) {
    const n = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(n) && n >= 0 && n <= 130) return Math.floor(n);
  }
  if (status === "HT") return 45;
  return null;
}

function mapMatch(m: any, league: any): any {
  const id = m?.id ?? m?.fixture_id ?? m?.fixture?.id ?? null;
  const ts = timestampMs(m);
  const status = normalizeStatus(m?.status_detail ?? m?.status ?? m?.fixture?.status?.short);
  const homeName = m?.teams?.home?.name ?? m?.homeTeam ?? "";
  const awayName = m?.teams?.away?.name ?? m?.awayTeam ?? "";
  const score = m?.score?.current ?? m?.goals ?? {};
  const elapsed = elapsedFromUpstream(m, status);
  return {
    id,
    homeTeam: homeName,
    awayTeam: awayName,
    fixture: {
      id,
      date: ts ? new Date(ts).toISOString() : null,
      timestamp: ts ? Math.floor(ts / 1000) : null,
      status: { short: status, long: m?.status_detail ?? status, elapsed },
    },
    league: {
      id: league?.id ?? m?.league?.id ?? null,
      name: league?.name ?? m?.league?.name ?? "Outros",
      country: league?.country ?? league?.cc ?? m?.league?.country ?? null,
      logo: league?.logo ?? league?.badge ?? null,
    },
    teams: {
      home: { id: m?.teams?.home?.id ?? null, name: homeName, logo: m?.teams?.home?.badge ?? null },
      away: { id: m?.teams?.away?.id ?? null, name: awayName, logo: m?.teams?.away?.badge ?? null },
    },
    goals: {
      home: typeof score.home === "number" ? score.home : null,
      away: typeof score.away === "number" ? score.away : null,
    },
    isLive: LIVE_STATUSES.has(status),
    __source: "sportsrc",
  };
}

async function fetchJson(url: string, init: RequestInit = {}): Promise<{ json: any; status: number; ms: number; error?: string }> {
  const started = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    const response = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(timer);
    const text = await response.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { json, status: response.status, ms: Date.now() - started, error: response.ok ? undefined : `http_${response.status}` };
  } catch (error) {
    return { json: null, status: 0, ms: Date.now() - started, error: String(error).slice(0, 160) };
  }
}

async function fetchSportsrc(date: string): Promise<{ matches: any[]; diag: SourceDiag }> {
  if (!SPORTSRC_KEY) return { matches: [], diag: { source: "sportsrc", status: 0, ms: 0, matches: 0, skipped: "missing_api_key" } };
  const url = new URL(`${SPORTSRC_BASE}/`);
  url.searchParams.set("type", "matches");
  url.searchParams.set("date", date);
  const r = await fetchJson(url.toString(), { headers: { "X-API-KEY": SPORTSRC_KEY, Accept: "application/json" } });
  const groups = Array.isArray(r.json?.data) ? r.json.data : [];
  const matches: any[] = [];
  for (const group of groups) {
    const league = group?.league ?? group?.tournament ?? null;
    for (const match of Array.isArray(group?.matches) ? group.matches : []) {
      const mapped = mapMatch(match, league);
      if (mapped.id && mapped.homeTeam && mapped.awayTeam) matches.push(mapped);
    }
  }
  return { matches, diag: { source: "sportsrc", status: r.status, ms: r.ms, matches: matches.length, error: r.error } };
}

function uniqueMatches(matches: any[]): any[] {
  const seen = new Set<string>();
  return matches.filter((m) => {
    const key = String(m?.id ?? `${m?.homeTeam}|${m?.awayTeam}|${m?.fixture?.date ?? ""}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" } });
  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.fixture != null) {
      return new Response(JSON.stringify({ ok: false, error: "FIXTURE_STATS_ENDPOINT_NOT_ENABLED_IN_ANALYST_ONLY_MODE" }), { status: 501, headers });
    }
    const date = typeof body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : new Date().toISOString().slice(0, 10);
    const result = await fetchSportsrc(date);
    const matches = body?.live === true ? result.matches.filter((m) => m.isLive) : result.matches;
    return new Response(JSON.stringify({ ok: true, matches: uniqueMatches(matches), diagnostics: result.diag, provenance: { source: "sportsrc", observedAt: new Date().toISOString(), inferredValues: false } }), { status: 200, headers });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: "FOOTBALL_API_UNAVAILABLE", detail: String(error).slice(0, 160) }), { status: 502, headers });
  }
});
