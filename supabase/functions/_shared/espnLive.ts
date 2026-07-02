// =====================================================================
// ESPN Public API — Live source (no auth required)
// ---------------------------------------------------------------------
// Endpoint: https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard
// Enriches each live event with per-event summary stats.
// The summary endpoint accepts ANY soccer league slug when the event ID is
// provided, so we use a single wildcard slug ("eng.1") to avoid mapping.
//
// Output shape MATCHES what scanner-pro-server/auto-mode-server expect:
//   { id, homeTeam, awayTeam, fixture:{id,date,status:{short,elapsed}},
//     league, teams:{home,away}, goals:{home,away},
//     stats:{ home:{shotsOnGoal,totalShots,corners,possession,dangerousAttacks},
//             away:{...} },
//     __source: 'espn' }
// =====================================================================

const ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard";
const ESPN_SUMMARY = (id: string) =>
  `https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/summary?event=${encodeURIComponent(id)}`;

const LIVE_STATE = new Set(["in", "halftime"]);

function n(v: unknown): number {
  if (v == null) return 0;
  const s = String(v).replace("%", "").trim();
  const num = Number(s);
  return Number.isFinite(num) ? num : 0;
}

function pickStat(list: any[], name: string): number {
  if (!Array.isArray(list)) return 0;
  const row = list.find((s) => String(s?.name || "").toLowerCase() === name.toLowerCase());
  if (!row) return 0;
  return n(row.value ?? row.displayValue);
}

function computeElapsed(status: any): number {
  const detail = String(status?.type?.detail || status?.displayClock || "");
  const m = detail.match(/(\d+)'?/);
  if (m) return Math.max(0, Math.min(120, Number(m[1])));
  const clockSec = Number(status?.clock);
  if (Number.isFinite(clockSec)) return Math.round(clockSec / 60);
  return 0;
}

function shortStatus(state: string, period?: number): string {
  const s = (state || "").toLowerCase();
  if (s === "halftime") return "HT";
  if (s === "in") return period === 2 ? "2H" : "1H";
  if (s === "post") return "FT";
  return "NS";
}

async function fetchWithTimeout(url: string, ms = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal, headers: { "Accept": "application/json" } });
  } finally {
    clearTimeout(to);
  }
}

async function fetchSummaryStats(eventId: string): Promise<{ home: any; away: any } | null> {
  try {
    const res = await fetchWithTimeout(ESPN_SUMMARY(eventId), 6000);
    if (!res.ok) return null;
    const json = await res.json();
    const teams = json?.boxscore?.teams;
    if (!Array.isArray(teams) || teams.length < 2) return null;
    const build = (t: any) => {
      const stats = t?.statistics || [];
      const sog = pickStat(stats, "shotsOnTarget");
      const total = pickStat(stats, "totalShots");
      const corners = pickStat(stats, "wonCorners");
      const possession = pickStat(stats, "possessionPct");
      const fouls = pickStat(stats, "foulsCommitted");
      const yellow = pickStat(stats, "yellowCards");
      const red = pickStat(stats, "redCards");
      const saves = pickStat(stats, "saves");
      // dangerousAttacks — proxy from shots+corners (engine also does this,
      // but we provide it here so hasStats is true from the LIVE payload).
      const da = Math.round(total * 1.5 + corners * 2);
      return {
        shotsOnGoal: sog, totalShots: total, corners, possession,
        dangerousAttacks: da, daEstimated: true,
        fouls, yellowCards: yellow, redCards: red, saves,
      };
    };
    return { home: build(teams[0]), away: build(teams[1]) };
  } catch {
    return null;
  }
}

async function pMap<T, R>(items: T[], fn: (x: T) => Promise<R>, concurrency = 4): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export interface EspnFetchOptions {
  liveOnly?: boolean;
  enrichStats?: boolean;
  maxEvents?: number;
}

export async function fetchEspnMatches(opts: EspnFetchOptions = {}): Promise<any[]> {
  const { liveOnly = true, enrichStats = true, maxEvents = 40 } = opts;
  let res: Response;
  try { res = await fetchWithTimeout(ESPN_SCOREBOARD, 9000); }
  catch { return []; }
  if (!res.ok) return [];
  const json = await res.json();
  const events: any[] = Array.isArray(json?.events) ? json.events : [];
  const filtered = events.filter((e) => {
    const st = e?.competitions?.[0]?.status?.type?.state;
    return liveOnly ? LIVE_STATE.has(String(st || "").toLowerCase()) : true;
  }).slice(0, maxEvents);

  const enriched = enrichStats ? await pMap(filtered, async (ev) => {
    const id = String(ev.id);
    const stats = await fetchSummaryStats(id);
    return { ev, stats };
  }, 5) : filtered.map((ev) => ({ ev, stats: null }));

  const out: any[] = [];
  for (const { ev, stats } of enriched) {
    const comp = ev?.competitions?.[0] || {};
    const status = comp?.status || {};
    const state = String(status?.type?.state || "").toLowerCase();
    const period = Number(status?.period || 1);
    const short = shortStatus(state, period);
    const elapsed = computeElapsed(status);
    const compss: any[] = Array.isArray(comp.competitors) ? comp.competitors : [];
    const home = compss.find((c) => c.homeAway === "home") || compss[0] || {};
    const away = compss.find((c) => c.homeAway === "away") || compss[1] || {};
    const homeName = home?.team?.displayName || home?.team?.name || "";
    const awayName = away?.team?.displayName || away?.team?.name || "";
    if (!homeName || !awayName) continue;
    const leagueName = ev?.altGameNote || ev?.season?.slug || "Soccer";
    const id = String(ev.id);
    out.push({
      id,
      homeTeam: homeName,
      awayTeam: awayName,
      fixture: {
        id,
        date: ev?.date || new Date().toISOString(),
        timestamp: ev?.date ? Math.floor(new Date(ev.date).getTime() / 1000) : null,
        status: { short, long: status?.type?.description || short, elapsed },
      },
      league: {
        id: null,
        name: leagueName,
        country: null,
        logo: null,
      },
      teams: {
        home: { id: home?.id ?? null, name: homeName, logo: home?.team?.logo || null },
        away: { id: away?.id ?? null, name: awayName, logo: away?.team?.logo || null },
      },
      goals: {
        home: home?.score != null ? Number(home.score) : null,
        away: away?.score != null ? Number(away.score) : null,
      },
      stats: stats || undefined,
      isLive: LIVE_STATE.has(state),
      __source: "espn",
    });
  }
  return out;
}

// Normalize team name for dedupe matching against SportsRC entries.
export function normalizeTeam(name: string): string {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(fc|cf|sc|ac|afc|cd|club|de|do|da|dos|das|the)\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}
