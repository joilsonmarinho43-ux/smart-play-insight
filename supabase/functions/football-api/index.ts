// =====================================================================
// football-api — agregador multi-fonte (ESPN + SportsRC v2)
// ---------------------------------------------------------------------
// Contrato PRESERVADO (não quebrar callers existentes):
//   POST { date: 'YYYY-MM-DD' } → { matches: [...], provider, counts, diag }
//   POST { live: true }         → idem (somente jogos ao vivo)
//   POST { fixture: <id> }      → { response: [{ team, statistics }], extra, provider }
//   POST { diag: true }         → diagnóstico das fontes (sem expor segredos)
//
// FATOS VERIFICADOS EM PRODUÇÃO (probe 2026-08-24) — não são suposições:
//   • A SportsRC v2 tem UM único endpoint: `GET /v2/?type=matches`.
//     `/v2/matches`, `/v2/live`, `/v2/matches/live` → 404.
//     `type=live` → 400 {"success":false,"message":"Invalid endpoint type"}.
//   • O filtro `status=live` do upstream É FURADO: devolve total_matches=0
//     mesmo quando `?type=matches&date=<hoje>` traz jogos "inprogress".
//     → por isso buscamos por DATA e filtramos o status LOCALMENTE.
//   • Sem `date`, o default do upstream é `date=upcoming` (não é "hoje").
//   • Status reais do upstream: notstarted | inprogress | finished
//     (status_detail: "Not started", "1st half", "Ended", "AP", ...).
//   • Os jogos NÃO trazem campo `minute` → o elapsed é derivado do kickoff.
//
// Cache (tabela cache_api) com chaves VERSIONADAS (`v2_`): um deploy novo
// nunca herda payload de uma versão antiga. Resposta vazia NUNCA é gravada
// no cache nem considerada dado válido.
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { fetchEspnMatches, lastEspnDiagnostics, normalizeTeam } from "../_shared/espnLive.ts";
import { fetchJson } from "../_shared/http.ts";

// Versão do formato de cache. INCREMENTE ao mudar o shape de `matches`.
const CACHE_VERSION = "v2";

const SPORTSRC_BASE = "https://api.sportsrc.org/v2";
const SPORTSRC_KEY = Deno.env.get("SPORTSRC_API_KEY") || "";

/** Orçamento de wall-clock por requisição (evita early termination). */
const REQUEST_BUDGET_MS = 25_000;

const CACHE_TTL = {
  LIVE: 120 * 1000,                      // 2 min
  PRE: 3 * 60 * 60 * 1000,               // 3h
  STATS_LIVE: 120 * 1000,                // 2 min
  STATS_FINAL: 7 * 24 * 60 * 60 * 1000,  // 7d
};

const LIVE_SHORT = new Set(["1H", "2H", "HT", "ET", "P", "LIVE"]);
const FINISHED_STATUSES = new Set([
  "FT", "AET", "PEN", "AP", "AWARDED", "FINISHED", "ENDED", "FULL TIME", "FULLTIME", "FULL-TIME",
]);

/** Backoff em memória por instância: após 429 não martelamos o upstream. */
let sportsrcBlockedUntil = 0;

function getSb() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

function isEmptyPayload(v: unknown): boolean {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

async function cacheGet(key: string, ttlMs: number): Promise<any | null> {
  try {
    const { data } = await getSb().from("cache_api")
      .select("dados_json, ultima_atualizacao")
      .eq("cache_key", key).maybeSingle();
    if (!data) return null;
    const age = Date.now() - new Date(data.ultima_atualizacao).getTime();
    if (age > ttlMs) return null;
    // Cache vazio NUNCA bloqueia uma nova tentativa.
    if (isEmptyPayload(data.dados_json)) return null;
    return data.dados_json;
  } catch (e) {
    console.warn(`[football-api] cache_read_error key=${key} error=${String(e).slice(0, 120)}`);
    return null;
  }
}

async function cacheGetStale(key: string): Promise<any | null> {
  try {
    const { data } = await getSb().from("cache_api")
      .select("dados_json").eq("cache_key", key).maybeSingle();
    if (!data || isEmptyPayload(data.dados_json)) return null;
    return data.dados_json;
  } catch { return null; }
}

async function cacheSet(key: string, payload: any, statusJogo: string) {
  if (isEmptyPayload(payload)) return; // nunca persistir vazio
  try {
    await getSb().from("cache_api").upsert({
      cache_key: key, dados_json: payload, status_jogo: statusJogo,
      ultima_atualizacao: new Date().toISOString(),
    }, { onConflict: "cache_key" });
  } catch (e) {
    console.error(`[football-api] cache_write_error key=${key} error=${String(e).slice(0, 120)}`);
  }
}

// ---------------------------------------------------------------------
// SportsRC
// ---------------------------------------------------------------------

export interface SourceDiag {
  source: string;
  status: number;
  ms: number;
  matches: number;
  error?: string;
  skipped?: string;
}

async function srcFetch(
  params: Record<string, string>,
  deadline: number,
): Promise<{ json: any; diag: SourceDiag }> {
  const base: SourceDiag = { source: "sportsrc", status: 0, ms: 0, matches: 0 };
  if (!SPORTSRC_KEY) {
    console.warn("[football-api] source=sportsrc skipped=missing_api_key");
    return { json: null, diag: { ...base, skipped: "missing_api_key", error: "missing_api_key" } };
  }
  if (Date.now() < sportsrcBlockedUntil) {
    const left = Math.round((sportsrcBlockedUntil - Date.now()) / 1000);
    console.warn(`[football-api] source=sportsrc skipped=backoff_rate_limit remaining=${left}s`);
    return { json: null, diag: { ...base, skipped: "backoff_rate_limit", error: "rate_limit" } };
  }

  const url = new URL(SPORTSRC_BASE + "/");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const r = await fetchJson<any>(url.toString(), {
    source: "football-api:sportsrc",
    timeoutMs: 9000,
    retries: 1,
    deadline,
    headers: { "X-API-KEY": SPORTSRC_KEY, Accept: "application/json" },
    label: JSON.stringify(params),
  });

  if (r.status === 429) sportsrcBlockedUntil = Date.now() + 60_000;
  if (r.status === 401 || r.status === 403) sportsrcBlockedUntil = Date.now() + 300_000;

  return { json: r.json, diag: { ...base, status: r.status, ms: r.ms, error: r.error } };
}

function normStatus(rawStatus: any, rawDetail: any): { short: string; elapsed: number | null } {
  const s = String(rawStatus || "").toUpperCase().replace(/[\s_-]+/g, "");
  const d = String(rawDetail || "").toUpperCase().trim();

  // 1) status canônico do upstream
  if (s === "NOTSTARTED" || s === "NS" || s === "SCHEDULED" || s === "TBD") {
    return { short: "NS", elapsed: null };
  }
  if (s === "FINISHED" || s === "ENDED" || s === "FT" || FINISHED_STATUSES.has(s)) {
    return { short: "FT", elapsed: 90 };
  }
  if (s === "CANCELED" || s === "CANCELLED" || s === "CANC" || s === "POSTPONED" || s === "PST") {
    return { short: "CANC", elapsed: null };
  }
  if (s === "INPROGRESS" || s === "LIVE" || s === "PLAYING") {
    if (/HALF ?TIME|^HT$/.test(d)) return { short: "HT", elapsed: 45 };
    if (/2ND HALF|SECOND HALF|^2H$/.test(d)) return { short: "2H", elapsed: null };
    if (/EXTRA/.test(d)) return { short: "ET", elapsed: 90 };
    if (/PENALT/.test(d)) return { short: "P", elapsed: 120 };
    return { short: "1H", elapsed: null };
  }

  // 2) fallback pelo detalhe textual
  if (/NOT ?STARTED/.test(d)) return { short: "NS", elapsed: null };
  if (/ENDED|FULL ?TIME|^FT$|^AP$|AFTER PENALT/.test(d)) return { short: "FT", elapsed: 90 };
  if (/HALF ?TIME|^HT$/.test(d)) return { short: "HT", elapsed: 45 };
  if (/1ST HALF|FIRST HALF|^1H$/.test(d)) return { short: "1H", elapsed: null };
  if (/2ND HALF|SECOND HALF|^2H$/.test(d)) return { short: "2H", elapsed: null };
  if (/CANCEL|POSTPON|ABANDON/.test(d)) return { short: "CANC", elapsed: null };

  return { short: s || "NS", elapsed: null };
}

/** Minutos desde o kickoff — a SportsRC não expõe `minute`. */
function elapsedFromKickoff(tsMs: number | null, short: string): number | null {
  if (!tsMs) return null;
  const mins = Math.floor((Date.now() - tsMs) / 60000);
  if (mins < 0) return null;
  if (short === "HT") return 45;
  if (short === "1H") return Math.max(1, Math.min(45, mins));
  if (short === "2H") return Math.max(46, Math.min(95, mins));
  return Math.max(0, Math.min(120, mins));
}

function mapMatch(m: any, league: any): any {
  const id = m?.id ?? m?.fixture_id;
  const ts = typeof m?.timestamp === "number" ? m.timestamp * (m.timestamp < 1e12 ? 1000 : 1) : null;
  const iso = ts ? new Date(ts).toISOString() : new Date().toISOString();
  const st = normStatus(m?.status, m?.status_detail);
  const homeName = m?.teams?.home?.name || "";
  const awayName = m?.teams?.away?.name || "";
  const score = m?.score?.current || {};
  const elapsed = m?.minute ?? st.elapsed ?? elapsedFromKickoff(ts, st.short);
  return {
    id,
    homeTeam: homeName,
    awayTeam: awayName,
    fixture: {
      id,
      date: iso,
      timestamp: ts ? Math.floor(ts / 1000) : null,
      status: { short: st.short, long: m?.status_detail || st.short, elapsed },
    },
    league: {
      id: league?.id ?? null,
      name: league?.name ?? "Outros",
      country: league?.country ?? league?.cc ?? null,
      logo: league?.logo || league?.badge || null,
    },
    teams: {
      home: { id: m?.teams?.home?.id ?? null, name: homeName, logo: m?.teams?.home?.badge || null },
      away: { id: m?.teams?.away?.id ?? null, name: awayName, logo: m?.teams?.away?.badge || null },
    },
    goals: {
      home: typeof score.home === "number" ? score.home : null,
      away: typeof score.away === "number" ? score.away : null,
    },
    isLive: LIVE_SHORT.has(st.short),
    __source: "sportsrc",
  };
}

/**
 * Busca jogos da SportsRC por DATA. Nunca usa `status=live` no upstream
 * (filtro comprovadamente furado) — o filtro de ao vivo é local.
 */
async function fetchSportsrcByDate(
  date: string,
  deadline: number,
): Promise<{ matches: any[]; diag: SourceDiag }> {
  const { json, diag } = await srcFetch({ type: "matches", date }, deadline);
  const groups: any[] = Array.isArray(json?.data) ? json.data : [];
  const out: any[] = [];
  for (const g of groups) {
    const league = g?.league || g?.tournament || null;
    for (const m of (Array.isArray(g?.matches) ? g.matches : [])) {
      const mapped = mapMatch(m, league);
      if (mapped.homeTeam && mapped.awayTeam) out.push(mapped);
    }
  }
  diag.matches = out.length;
  return { matches: out, diag };
}

// ---------------------------------------------------------------------
// Estatísticas de um jogo (type=detail — o plano FREE não libera type=stats)
// ---------------------------------------------------------------------

const STAT_KEY_MAP: Record<string, string[]> = {
  "Shots on Goal": ["shots_on_target", "shots_on_goal", "shots_on", "sot"],
  "Total Shots": ["shots_total", "total_shots", "shots"],
  "Shots off Goal": ["shots_off_target", "shots_off"],
  "Corner Kicks": ["corners", "corner_kicks"],
  "Ball Possession": ["possession", "ball_possession"],
  "Dangerous Attacks": ["dangerous_attacks", "attacks_dangerous"],
  "Attacks": ["attacks"],
  "Yellow Cards": ["yellow_cards", "yellowcards", "yellows"],
  "Red Cards": ["red_cards", "redcards", "reds"],
  "Fouls": ["fouls"],
  "Offsides": ["offsides"],
  "Goalkeeper Saves": ["saves", "goalkeeper_saves"],
};

function pickStat(obj: any, candidates: string[]): any {
  if (!obj) return null;
  for (const k of candidates) {
    if (obj[k] != null) return obj[k];
    if (obj[k.toUpperCase()] != null) return obj[k.toUpperCase()];
  }
  return null;
}

function toApiSportsStats(teamMeta: any, srcSide: any): any {
  const statistics: any[] = [];
  for (const [apiType, keys] of Object.entries(STAT_KEY_MAP)) {
    const v = pickStat(srcSide, keys);
    statistics.push({
      type: apiType,
      value: v != null ? (apiType === "Ball Possession" ? `${v}%` : v) : null,
    });
  }
  return { team: teamMeta || { id: null, name: null }, statistics };
}

async function fetchFixtureStats(fixtureId: string | number, deadline: number): Promise<any> {
  const key = `${CACHE_VERSION}_srcv2_stats_${fixtureId}`;
  const cached = await cacheGet(key, CACHE_TTL.STATS_LIVE);
  if (cached) return cached;

  const { json, diag } = await srcFetch({ type: "detail", id: String(fixtureId) }, deadline);
  if (!json) {
    const stale = await cacheGetStale(key);
    if (stale) return stale;
    return { response: [], extra: null, provider: "sportsrc", error: diag.error || "no_data" };
  }

  const mi = json?.data?.match_info || {};
  const teamsRaw = mi?.teams || {};
  const score = mi?.score || {};
  const cur = score?.current || {};
  const period1 = String(score?.period_1 || "");
  const [ht1, ht2] = period1.includes("-")
    ? period1.split("-").map((s) => Number(s.trim()))
    : [null, null];

  const homeTeam = { id: null, name: teamsRaw?.home?.name || null };
  const awayTeam = { id: null, name: teamsRaw?.away?.name || null };
  const statsRaw = json?.data?.statistics || {};

  const out = {
    response: [
      toApiSportsStats(homeTeam, statsRaw?.home),
      toApiSportsStats(awayTeam, statsRaw?.away),
    ],
    extra: {
      goals: { home: cur?.home ?? null, away: cur?.away ?? null },
      halftime: { home: ht1 ?? null, away: ht2 ?? null },
      status: mi?.status_detail || mi?.status || null,
      venue: mi?.venue || null,
    },
    provider: "sportsrc",
  };

  const finished = normStatus(mi?.status, mi?.status_detail).short === "FT";
  await cacheSet(key, out, finished ? "STATS" : "LIVE");
  return out;
}

// ---------------------------------------------------------------------
// Merge / dedupe entre fontes
// ---------------------------------------------------------------------

function mergeSources(primary: any[], secondary: any[]): any[] {
  const seen = new Set<string>();
  const merged: any[] = [];
  const keyOf = (m: any) => `${normalizeTeam(m.homeTeam)}|${normalizeTeam(m.awayTeam)}`;
  for (const m of primary) {
    const k = keyOf(m);
    if (!k || k === "|") continue;
    if (seen.has(k)) continue;
    seen.add(k); merged.push(m);
  }
  for (const m of secondary) {
    const k = keyOf(m);
    if (!k || k === "|") continue;
    if (seen.has(k)) continue;
    seen.add(k); merged.push(m);
  }
  return merged;
}

function utcDate(offsetDays = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const deadline = Date.now() + REQUEST_BUDGET_MS;

  try {
    const body = await req.json().catch(() => ({}));

    // ---------------- diag ----------------
    if (body?.diag === true) {
      const [espn, src] = await Promise.all([
        fetchEspnMatches({ liveOnly: false, enrichStats: false, deadline }).catch(() => []),
        fetchSportsrcByDate(utcDate(0), deadline).catch(() => ({
          matches: [], diag: { source: "sportsrc", status: 0, ms: 0, matches: 0, error: "throw" },
        })),
      ]);
      return json({
        ok: true,
        version: CACHE_VERSION,
        env: {
          sportsrcKey: SPORTSRC_KEY ? "present" : "missing",
          supabaseUrl: Deno.env.get("SUPABASE_URL") ? "present" : "missing",
          serviceRole: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ? "present" : "missing",
        },
        sources: [
          { source: "espn", ...lastEspnDiagnostics(), matches: espn.length },
          src.diag,
        ],
      });
    }

    // ---------------- stats por fixture ----------------
    if (body?.fixture != null) {
      return json(await fetchFixtureStats(body.fixture, deadline));
    }

    // ---------------- modo LIVE ----------------
    if (body?.live === true) {
      const cacheKey = `${CACHE_VERSION}_live_multi_source`;
      const cached = await cacheGet(cacheKey, CACHE_TTL.LIVE);
      if (cached) {
        return json({ matches: cached, provider: "multi-cache", counts: { cached: cached.length } });
      }

      // ESPN (com estatísticas) + SportsRC por data (hoje e ontem UTC — jogos
      // que atravessam a meia-noite), filtrando o status localmente.
      const [espn, srcToday, srcYesterday] = await Promise.all([
        fetchEspnMatches({ liveOnly: true, enrichStats: true, deadline })
          .catch((e) => { console.warn(`[football-api] source=espn error=${String(e).slice(0, 100)}`); return [] as any[]; }),
        fetchSportsrcByDate(utcDate(0), deadline),
        fetchSportsrcByDate(utcDate(-1), deadline),
      ]);

      const srcAll = [...srcToday.matches, ...srcYesterday.matches];
      const srcLive = srcAll.filter((m) => LIVE_SHORT.has(m.fixture.status.short));
      const merged = mergeSources(espn, srcLive);

      console.log(
        `[football-api] live merged espn=${espn.length} sportsrc=${srcLive.length}` +
        `/${srcAll.length} merged=${merged.length} ` +
        `sportsrc_status=${srcToday.diag.status}${srcToday.diag.error ? ` error=${srcToday.diag.error}` : ""} ` +
        `espn_status=${lastEspnDiagnostics().status}${lastEspnDiagnostics().error ? ` error=${lastEspnDiagnostics().error}` : ""}`,
      );

      if (merged.length > 0) {
        await cacheSet(cacheKey, merged, "LIVE");
        return json({
          matches: merged,
          provider: "multi",
          counts: { espn: espn.length, sportsrc: srcLive.length, merged: merged.length },
        });
      }

      // Zero jogos: informa a CAUSA e tenta stale como último recurso.
      const stale = await cacheGetStale(cacheKey);
      const reason = (srcToday.diag.error || lastEspnDiagnostics().error)
        ? `source_error espn=${lastEspnDiagnostics().error || "ok"} sportsrc=${srcToday.diag.error || "ok"}`
        : "no_live_matches_upstream";
      console.warn(`[football-api] live empty reason=${reason}`);
      if (Array.isArray(stale) && stale.length > 0) {
        return json({ matches: stale, provider: "multi-stale", reason, counts: { stale: stale.length } });
      }
      return json({
        matches: [], provider: "multi", reason,
        counts: { espn: 0, sportsrc: 0, sportsrcTotalToday: srcAll.length },
        diag: [{ source: "espn", ...lastEspnDiagnostics() }, srcToday.diag],
      });
    }

    // ---------------- modo pré-jogo por data ----------------
    const date = String(body?.date || utcDate(0));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return json({ error: "invalid_date", matches: [] }, 400);
    }

    const cacheKey = `${CACHE_VERSION}_date_${date}`;
    const cached = await cacheGet(cacheKey, CACHE_TTL.PRE);
    if (cached) {
      return json({ matches: cached, provider: "multi-cache", counts: { cached: cached.length } });
    }

    // SportsRC é a fonte principal para o pré-jogo (cobertura maior de ligas);
    // ESPN entra como complemento/fallback — nenhuma das duas é removida.
    const [src, espn] = await Promise.all([
      fetchSportsrcByDate(date, deadline),
      fetchEspnMatches({ liveOnly: false, enrichStats: false, date, maxEvents: 200, deadline })
        .catch(() => [] as any[]),
    ]);

    const merged = mergeSources(src.matches, espn);
    console.log(
      `[football-api] date=${date} sportsrc=${src.matches.length} (status=${src.diag.status}${src.diag.error ? ` error=${src.diag.error}` : ""}) ` +
      `espn=${espn.length} (status=${lastEspnDiagnostics().status}) merged=${merged.length}`,
    );

    if (merged.length > 0) {
      await cacheSet(cacheKey, merged, "PRE");
      return json({
        matches: merged,
        provider: src.matches.length ? "multi" : "espn",
        counts: { sportsrc: src.matches.length, espn: espn.length, merged: merged.length },
      });
    }

    const stale = await cacheGetStale(cacheKey);
    if (Array.isArray(stale) && stale.length > 0) {
      return json({ matches: stale, provider: "multi-stale", counts: { stale: stale.length } });
    }
    return json({
      matches: [], provider: "multi",
      reason: `espn=${lastEspnDiagnostics().error || "empty"} sportsrc=${src.diag.error || "empty"}`,
      counts: { sportsrc: 0, espn: 0 },
      diag: [{ source: "espn", ...lastEspnDiagnostics() }, src.diag],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[football-api] fatal error=${msg}`);
    // 200 proposital: os callers tratam `matches: []` sem quebrar a UI.
    return json({ error: msg, matches: [], response: [] });
  }
});
