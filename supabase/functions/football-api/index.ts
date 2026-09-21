import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
/* Nexus 33 football-api: source normalization and provenance only. */
import { fetchEspnMatches } from "../_shared/espnLive.ts";
const SPORTSRC_KEY = Deno.env.get("SPORTSRC_API_KEY") || "";
const SPORTSRC_BASE = "https://api.sportsrc.org/v2";
const LIVE_STATUSES = new Set(["1H", "2H", "HT", "ET", "P"]);

export interface SourceDiag { source: string; status: number; ms: number; matches: number; error?: string; skipped?: string; }

function normalizeStatus(raw: unknown): string {
  const s = String(raw ?? "").toUpperCase().replace(/[\s_-]+/g, "");
  if (["FINISHED", "ENDED", "FT", "FULLTIME"].includes(s)) return "FT";
  if (["CANCELED", "CANCELLED", "POSTPONED", "PST", "ABANDONED"].includes(s)) return "CANC";
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
    id, homeTeam: homeName, awayTeam: awayName,
    fixture: { id, date: ts ? new Date(ts).toISOString() : null, timestamp: ts ? Math.floor(ts / 1000) : null, status: { short: status, long: m?.status_detail ?? status, elapsed } },
    league: { id: league?.id ?? m?.league?.id ?? null, name: league?.name ?? m?.league?.name ?? "Outros", country: league?.country ?? league?.cc ?? m?.league?.country ?? null, logo: league?.logo ?? league?.badge ?? null },
    teams: { home: { id: m?.teams?.home?.id ?? null, name: homeName, logo: m?.teams?.home?.badge ?? null }, away: { id: m?.teams?.away?.id ?? null, name: awayName, logo: m?.teams?.away?.badge ?? null } },
    goals: { home: typeof score.home === "number" ? score.home : null, away: typeof score.away === "number" ? score.away : null },
    isLive: LIVE_STATUSES.has(status), __source: "sportsrc",
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

async function fetchSportsrc(params: Record<string, string>): Promise<{ json: any; diag: SourceDiag }> {
  if (!SPORTSRC_KEY) return { json: null, diag: { source: "sportsrc", status: 0, ms: 0, matches: 0, skipped: "missing_api_key" } };
  const url = new URL(`${SPORTSRC_BASE}/`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const r = await fetchJson(url.toString(), { headers: { "X-API-KEY": SPORTSRC_KEY, Accept: "application/json" } });
  return { json: r.json, diag: { source: "sportsrc", status: r.status, ms: r.ms, matches: 0, error: r.error } };
}

async function fetchMatches(date: string): Promise<{ matches: any[]; diag: SourceDiag }> {
  const { json, diag } = await fetchSportsrc({ type: "matches", date });
  const groups = Array.isArray(json?.data) ? json.data : [];
  const matches: any[] = [];
  for (const group of groups) {
    const league = group?.league ?? group?.tournament ?? null;
    for (const match of Array.isArray(group?.matches) ? group.matches : []) {
      const mapped = mapMatch(match, league);
      if (mapped.id && mapped.homeTeam && mapped.awayTeam) matches.push(mapped);
    }
  }
  diag.matches = matches.length;
  return { matches, diag };
}

const STAT_KEYS: Record<string, string[]> = {
  "Shots on Goal": ["shots_on_target", "shots_on_goal", "shots_on", "sot"],
  "Total Shots": ["shots_total", "total_shots", "shots"],
  "Shots off Goal": ["shots_off_target", "shots_off"],
  "Corner Kicks": ["corners", "corner_kicks"],
  "Ball Possession": ["possession", "ball_possession"],
  "Dangerous Attacks": ["dangerous_attacks", "attacks_dangerous"],
  "Attacks": ["attacks"], "Yellow Cards": ["yellow_cards", "yellowcards", "yellows"],
  "Red Cards": ["red_cards", "redcards", "reds"], "Fouls": ["fouls"], "Offsides": ["offsides"],
};
function statValue(side: any, keys: string[]): any {
  for (const key of keys) if (side?.[key] != null || side?.[key.toUpperCase()] != null) return side?.[key] ?? side?.[key.toUpperCase()];
  return null;
}
function normalizeStats(team: any, side: any): any {
  return { team: team ?? { id: null, name: null }, statistics: Object.entries(STAT_KEYS).map(([type, keys]) => ({ type, value: statValue(side, keys) })) };
}

async function fetchFixtureStats(fixtureId: string | number): Promise<any> {
  const { json, diag } = await fetchSportsrc({ type: "detail", id: String(fixtureId) });
  if (!json) return { response: [], extra: null, provider: "sportsrc", error: diag.error ?? "no_data" };
  const info = json?.data?.match_info ?? {};
  const teams = info?.teams ?? {};
  const score = info?.score?.current ?? {};
  const stats = json?.data?.statistics ?? {};
  const period1 = String(info?.score?.period_1 ?? "");
  const [htHome, htAway] = period1.includes("-") ? period1.split("-").map((v: string) => Number(v.trim())) : [null, null];
  return {
    response: [normalizeStats(teams?.home, stats?.home), normalizeStats(teams?.away, stats?.away)],
    extra: { goals: { home: score?.home ?? null, away: score?.away ?? null }, halftime: { home: Number.isFinite(htHome) ? htHome : null, away: Number.isFinite(htAway) ? htAway : null }, status: info?.status_detail ?? info?.status ?? null, venue: info?.venue ?? null },
    provider: "sportsrc",
  };
}

Deno.serve(async (req) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const authorization = req.headers.get("authorization")?.replace(/^Bearer\\s+/i, "").trim() || "";
  const apiKey = req.headers.get("apikey")?.trim() || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const internal = !!serviceKey && (authorization === serviceKey || apiKey === serviceKey);
  if (!internal) {
    if (!authorization) return new Response(JSON.stringify({ ok: false, error: "AUTH_REQUIRED" }), { status: 401, headers: cors });
    const authClient = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
    const { data: { user }, error: authError } = await authClient.auth.getUser(authorization);
    if (authError || !user) return new Response(JSON.stringify({ ok: false, error: "AUTH_REQUIRED" }), { status: 401, headers: cors });
    const { data: allowed, error: rateError } = await authClient.rpc("check_rate_limit", {
      _bucket: "football-api",
      _subject: user.id,
      _max_calls: 30,
      _window_seconds: 60,
    });
    if (rateError) return new Response(JSON.stringify({ ok: false, error: "RATE_LIMIT_UNAVAILABLE" }), { status: 503, headers: cors });
    if (allowed === false) return new Response(JSON.stringify({ ok: false, error: "RATE_LIMITED", retry_after: 60 }), {
      status: 429, headers: { ...cors, "Retry-After": "60" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    if (body?.fixture != null) return new Response(JSON.stringify(await fetchFixtureStats(body.fixture)), { status: 200, headers: cors });
    if (body?.diag === true) return new Response(JSON.stringify({ ok: true, source: "sportsrc", apiKey: SPORTSRC_KEY ? "present" : "missing" }), { status: 200, headers: cors });
    const date = typeof body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : new Date().toISOString().slice(0, 10);
    const { matches, diag } = await fetchMatches(date);
    let filtered = body?.live === true ? matches.filter((match) => match.isLive) : matches;
    if (body?.live === true) {
      try {
        const espn = await fetchEspnMatches({ liveOnly: true, enrichStats: true, maxEvents: 20, deadline: Date.now() + 12000 });
        const byTeams = new Map<string, any>();
        for (const em of espn) byTeams.set(`${teamKey(em.homeTeam)}|${teamKey(em.awayTeam)}`, em);
        filtered = filtered.map((m:any) => {
          const em=byTeams.get(`${teamKey(m.homeTeam)}|${teamKey(m.awayTeam)}`);
          return em?.stats ? {...m,liveStats:toLiveStats(em.stats),stats:em.stats,__liveStatsSource:"espn"} : m;
        });
        const existing=new Set(filtered.map((m:any)=>`${teamKey(m.homeTeam)}|${teamKey(m.awayTeam)}`));
        for(const em of espn){
          const key=`${teamKey(em.homeTeam)}|${teamKey(em.awayTeam)}`;
          if(existing.has(key)) continue;
          filtered.push({...em,liveStats:toLiveStats(em.stats),__source:"espn"});
        }
      } catch (e) {
        console.warn("[football-api] ESPN live enrichment failed",e);
      }
    }
    return new Response(JSON.stringify({ ok: true, matches: uniqueMatches(filtered), provider: body?.live === true ? "sportsrc+espn" : "sportsrc", counts: { total: filtered.length }, diag, provenance: { source: body?.live === true ? "sportsrc+espn" : "sportsrc", observedAt: new Date().toISOString(), inferredValues: false } }), { status: 200, headers: cors });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: "FOOTBALL_API_UNAVAILABLE", detail: String(error).slice(0, 160) }), { status: 502, headers: cors });
  }
});

function teamKey(name: unknown): string {
  return String(name || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\b(fc|cf|sc|ac|afc|cd|club|de|do|da|dos|das|the)\b/g, "").replace(/[^a-z0-9]+/g, "").trim();
}
function toLiveStats(stats: any): any | undefined {
  if (!stats?.home || !stats?.away) return undefined;
  const h=stats.home,a=stats.away;
  const finite=(v:any)=>Number.isFinite(Number(v))?Number(v):null;
  const pressure=(side:any)=>{
    const da=finite(side?.dangerousAttacks), sog=finite(side?.shotsOnGoal), corners=finite(side?.corners);
    return da!==null&&sog!==null&&corners!==null
      ? Math.min(100,Math.round(da*0.6+sog*8+corners*3))
      : null;
  };
  return {
    dangerousAttacks:[finite(h.dangerousAttacks),finite(a.dangerousAttacks)],
    corners:[finite(h.corners),finite(a.corners)],
    possession:[finite(h.possession),finite(a.possession)],
    pressureIndex:[pressure(h),pressure(a)],
  };
}
function uniqueMatches(matches: any[]): any[] {
  const seen = new Set<string>();
  return matches.filter((match) => { const key = String(match?.id ?? `${match?.homeTeam}|${match?.awayTeam}|${match?.fixture?.date ?? ""}`); if (seen.has(key)) return false; seen.add(key); return true; });
}
