// =====================================================================
// ESPN Public API — fonte sem autenticação (live + pré-jogo por data)
// ---------------------------------------------------------------------
// Endpoints (verificados em produção):
//   scoreboard : https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard
//                aceita ?dates=YYYYMMDD (sem o parâmetro devolve "hoje")
//   summary    : .../soccer/eng.1/summary?event=<id>
//                o slug da liga é ignorado quando o event id é informado
//
// Formato de saída IDÊNTICO ao esperado por scanner-pro-server /
// auto-mode-server / football-api:
//   { id, homeTeam, awayTeam, fixture:{id,date,timestamp,status:{short,long,elapsed}},
//     league, teams:{home,away}, goals:{home,away},
//     stats:{ home:{...}, away:{...} }, isLive, __source:'espn' }
//
// Regras de robustez:
//   • todo fetch tem timeout individual (AbortController) e log estruturado;
//   • o enriquecimento de estatísticas respeita um deadline global — nunca
//     estoura o wall-clock da edge function;
//   • resposta vazia NUNCA é tratada como sucesso silencioso: devolvemos
//     diagnóstico em `lastDiagnostics()`.
// =====================================================================

import { fetchJson, pMapDeadline } from "./http.ts";

// A ESPN devolve 403 para clientes sem User-Agent de navegador (é o que
// acontece no runtime Deno, tanto no Lovable quanto na VPS). Sem estes
// cabeçalhos a fonte ESPN some silenciosamente (espn=0).
const ESPN_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Referer: "https://www.espn.com/",
};

const ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard";
const ESPN_SUMMARY = (id: string) =>
  `https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/summary?event=${encodeURIComponent(id)}`;

const LIVE_STATE = new Set(["in", "halftime"]);

// A ESPN bloqueia (403) faixas de IP de datacenter — é o caso da egress do
// Supabase hospedado e de várias VPS. Quando isso acontece repetimos a mesma
// URL por espelhos públicos de leitura. Ordem: direto → espelhos.
const MIRRORS: ((u: string) => string)[] = [
  (u) => u,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
];

/** Índice do espelho que funcionou por último (evita repetir o que falha). */
let mirrorIdx = 0;

async function espnFetch(url: string, timeoutMs: number, deadline: number, label: string) {
  const order = [mirrorIdx, ...MIRRORS.map((_, i) => i).filter((i) => i !== mirrorIdx)];
  let last = await fetchJson<any>(MIRRORS[order[0]](url), {
    source: "espn", timeoutMs, retries: 0, deadline, headers: ESPN_HEADERS, label,
  });
  if (last.ok) return last;
  for (const i of order.slice(1)) {
    if (Date.now() > deadline) break;
    last = await fetchJson<any>(MIRRORS[i](url), {
      source: `espn:mirror${i}`, timeoutMs, retries: 0, deadline, headers: ESPN_HEADERS, label,
    });
    if (last.ok) { mirrorIdx = i; return last; }
  }
  return last;
}


export interface EspnDiagnostics {
  status: number;
  ms: number;
  events: number;
  kept: number;
  enriched: number;
  error?: string;
}

let diagnostics: EspnDiagnostics = { status: 0, ms: 0, events: 0, kept: 0, enriched: 0 };
export function lastEspnDiagnostics(): EspnDiagnostics {
  return diagnostics;
}

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

async function fetchSummaryStats(
  eventId: string,
  deadline: number,
): Promise<{ home: any; away: any } | null> {
  const r = await fetchJson<any>(ESPN_SUMMARY(eventId), {
    source: "espn:summary",
    timeoutMs: 5000,
    retries: 0,
    deadline,
    headers: ESPN_HEADERS,
  });
  const teams = r.json?.boxscore?.teams;
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
    // dangerousAttacks — proxy a partir de finalizações + escanteios.
    const da = Math.round(total * 1.5 + corners * 2);
    return {
      shotsOnGoal: sog, totalShots: total, corners, possession,
      dangerousAttacks: da, daEstimated: true,
      fouls, yellowCards: yellow, redCards: red, saves,
    };
  };
  return { home: build(teams[0]), away: build(teams[1]) };
}

export interface EspnFetchOptions {
  liveOnly?: boolean;
  enrichStats?: boolean;
  maxEvents?: number;
  /** 'YYYY-MM-DD' — quando informado busca o scoreboard daquele dia. */
  date?: string;
  /** Epoch ms limite para o trabalho total desta chamada. */
  deadline?: number;
}

export async function fetchEspnMatches(opts: EspnFetchOptions = {}): Promise<any[]> {
  const {
    liveOnly = true,
    enrichStats = true,
    maxEvents = 40,
    date,
    deadline = Date.now() + 20000,
  } = opts;

  const url = date
    ? `${ESPN_SCOREBOARD}?dates=${date.replace(/-/g, "")}&limit=200`
    : `${ESPN_SCOREBOARD}?limit=200`;

  const r = await fetchJson<any>(url, {
    source: "espn:scoreboard",
    timeoutMs: 8000,
    retries: 1,
    deadline,
    headers: ESPN_HEADERS,
    label: date ? `date=${date}` : "live",
  });

  if (!r.ok || !r.json) {
    diagnostics = { status: r.status, ms: r.ms, events: 0, kept: 0, enriched: 0, error: r.error };
    return [];
  }

  const events: any[] = Array.isArray(r.json?.events) ? r.json.events : [];
  const filtered = events.filter((e) => {
    const st = e?.competitions?.[0]?.status?.type?.state;
    return liveOnly ? LIVE_STATE.has(String(st || "").toLowerCase()) : true;
  }).slice(0, maxEvents);

  const enrichDeadline = Math.min(deadline, Date.now() + 12000);
  const enriched = enrichStats && filtered.length
    ? await pMapDeadline(
      filtered,
      async (ev: any) => ({ ev, stats: await fetchSummaryStats(String(ev.id), enrichDeadline) }),
      5,
      enrichDeadline,
    )
    : filtered.map((ev) => ({ ev, stats: null }));

  const out: any[] = [];
  let withStats = 0;
  for (let i = 0; i < filtered.length; i++) {
    const row = enriched[i] as { ev: any; stats: any } | null;
    const ev = row?.ev ?? filtered[i];
    const stats = row?.stats ?? null;
    if (stats) withStats++;
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
    const leagueName = ev?.leagues?.[0]?.name || ev?.altGameNote || ev?.season?.slug || "Soccer";
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
      league: { id: null, name: leagueName, country: null, logo: null },
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

  diagnostics = {
    status: r.status, ms: r.ms, events: events.length, kept: out.length, enriched: withStats,
  };
  console.log(
    `[espn] ${date ? `date=${date}` : "live"} status=${r.status} duration=${r.ms}ms events=${events.length} kept=${out.length} stats=${withStats}`,
  );
  return out;
}

// Normaliza o nome do time para deduplicação entre fontes (ESPN ↔ SportsRC).
export function normalizeTeam(name: string): string {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(fc|cf|sc|ac|afc|cd|club|de|do|da|dos|das|the)\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}
