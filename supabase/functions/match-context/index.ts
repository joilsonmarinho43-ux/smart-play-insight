// =====================================================================
// match-context — SportsRC powered (API-Sports REMOVIDA)
// ---------------------------------------------------------------------
// Mantém a mesma response shape consumida por useMatchReading:
//   { lineups, injuries, motivation, fatigue, odds, reliability, generatedAt }
//
// Fontes:
//   - SportsRC v2 via edge proxy `free-football-proxy`
//     • type=lineups&id=<fixtureId>
//     • type=odds&id=<fixtureId>
//     • type=standing&id=<fixtureId>
//     • type=h2h&id=<fixtureId>
// Injuries não são fornecidas por nenhuma das 3 APIs gratuitas → retorna baixo.
// =====================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const CACHE_TTL_MS = 8 * 60 * 1000;

let _sb: ReturnType<typeof createClient> | null = null;
function sb() {
  if (_sb) return _sb;
  _sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  return _sb;
}

async function cacheGet(key: string) {
  try {
    const { data } = await sb()
      .from("cache_api")
      .select("dados_json, ultima_atualizacao")
      .eq("cache_key", key)
      .maybeSingle();
    if (!data) return null;
    const age = Date.now() - new Date(data.ultima_atualizacao).getTime();
    if (age > CACHE_TTL_MS) return null;
    return data.dados_json;
  } catch { return null; }
}

async function cacheSet(key: string, value: any) {
  try {
    await sb().from("cache_api").upsert({
      cache_key: key,
      dados_json: value,
      status_jogo: "PRE",
      ultima_atualizacao: new Date().toISOString(),
    }, { onConflict: "cache_key" });
  } catch (e) { console.error("cacheSet", e); }
}

// SportsRC via proxy
async function sportsrc(type: string, id: string | number): Promise<any> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/free-football-proxy`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        provider: "sportsrc",
        path: "/",
        params: { type, id: String(id) },
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!json?.ok) return null;
    return json.data ?? null;
  } catch (e) {
    console.warn(`sportsrc ${type} fail`, e);
    return null;
  }
}

interface Body {
  fixtureId?: number | string;
  leagueId?: number;
  season?: number;
  homeId?: number;
  awayId?: number;
  homeName?: string;
  awayName?: string;
  kickoffISO?: string;
}

function parseLineups(payload: any, homeName?: string, awayName?: string) {
  const d = payload?.data || payload || {};
  const home = d?.home || d?.lineups?.home || null;
  const away = d?.away || d?.lineups?.away || null;
  const has = !!(home || away);
  return {
    home: {
      formation: home?.formation || home?.formation_str || null,
      coach: home?.coach?.name || home?.coach || null,
      confirmed: !!home,
    },
    away: {
      formation: away?.formation || away?.formation_str || null,
      coach: away?.coach?.name || away?.coach || null,
      confirmed: !!away,
    },
    source: has ? "oficial" : "estimado",
  };
}

function parseStanding(payload: any, homeName?: string, awayName?: string) {
  const d = payload?.data || payload || {};
  const rows: any[] = Array.isArray(d) ? d : (Array.isArray(d?.standings) ? d.standings : (Array.isArray(d?.standing) ? d.standing : []));
  const total = rows.length;
  const find = (name?: string) =>
    name ? rows.find((r) => (r?.team?.name || r?.name || "").toLowerCase() === name.toLowerCase()) : null;
  const stake = (rank: number | null) => {
    if (!rank || !total) return "meio-tabela";
    if (rank <= 4) return "disputa por título";
    if (rank <= 6) return "classificação continental";
    if (rank >= total - 3) return "luta contra rebaixamento";
    return "meio-tabela";
  };
  const h = find(homeName);
  const a = find(awayName);
  return {
    motivation: {
      home: { stake: stake(h?.rank ?? h?.position ?? null), rank: h?.rank ?? h?.position ?? null },
      away: { stake: stake(a?.rank ?? a?.position ?? null), rank: a?.rank ?? a?.position ?? null },
    },
    haveStandings: rows.length > 0,
  };
}

function parseOdds(payload: any) {
  if (!payload) return null;
  const d = payload?.data || payload;
  // SportsRC odds: tentamos extrair 1x2, over/under 2.5 e BTTS
  const books: any[] = Array.isArray(d?.bookmakers) ? d.bookmakers : (Array.isArray(d) ? d : []);
  if (books.length === 0) return null;
  const collect = {
    home: [] as number[], draw: [] as number[], away: [] as number[],
    over25: [] as number[], under25: [] as number[],
    bttsYes: [] as number[], bttsNo: [] as number[],
  };
  const names: string[] = [];
  for (const bk of books) {
    names.push(bk?.name || "bookmaker");
    const markets: any[] = bk.markets || bk.bets || [];
    for (const m of markets) {
      const mname = String(m?.name || m?.market || "").toLowerCase();
      const values: any[] = m?.values || m?.odds || m?.selections || [];
      const push = (arr: number[], odd: any) => { const n = Number(odd); if (n > 1) arr.push(n); };
      const find = (label: string) =>
        values.find((v: any) => (v?.value || v?.name || v?.label || "").toString().toLowerCase() === label.toLowerCase())?.odd;
      if (mname.includes("match winner") || mname.includes("1x2") || mname === "match result") {
        push(collect.home, find("home") ?? find("1"));
        push(collect.draw, find("draw") ?? find("x"));
        push(collect.away, find("away") ?? find("2"));
      } else if (mname.includes("over/under") || mname.includes("goals over")) {
        push(collect.over25, find("over 2.5"));
        push(collect.under25, find("under 2.5"));
      } else if (mname.includes("both teams") || mname.includes("btts")) {
        push(collect.bttsYes, find("yes"));
        push(collect.bttsNo, find("no"));
      }
    }
  }
  const avg = (a: number[]) => a.length ? Math.round((a.reduce((s, v) => s + v, 0) / a.length) * 100) / 100 : null;
  const count = books.length;
  return {
    home: avg(collect.home), draw: avg(collect.draw), away: avg(collect.away),
    over25: avg(collect.over25), under25: avg(collect.under25),
    bttsYes: avg(collect.bttsYes), bttsNo: avg(collect.bttsNo),
    meta: { bookmakers: count, sourceLabel: count > 1 ? `Média de ${count} casas` : (names[0] || "bookmaker"), primaryBookmaker: names[0] || null },
  };
}

function parseH2HRecent(payload: any, homeName?: string, awayName?: string) {
  if (!payload) return { home: null, away: null };
  const d = payload?.data || payload;
  const lastHome: any[] = Array.isArray(d?.last_home) ? d.last_home : (Array.isArray(d?.home_last_matches) ? d.home_last_matches : []);
  const lastAway: any[] = Array.isArray(d?.last_away) ? d.last_away : (Array.isArray(d?.away_last_matches) ? d.away_last_matches : []);
  const fatigue = (list: any[]) => {
    if (!list.length) return null;
    const now = Date.now();
    const days = list.map((m) => (typeof m?.timestamp === "number" ? (now - m.timestamp * (m.timestamp < 1e12 ? 1000 : 1)) / 86400000 : null)).filter((d) => d != null) as number[];
    const last10d = days.filter((d) => d >= 0 && d <= 10).length;
    const rest = days.length > 0 ? Math.max(0, Math.round(Math.min(...days))) : null;
    return { gamesLast10d: last10d, restDays: rest };
  };
  return { home: fatigue(lastHome), away: fatigue(lastAway) };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body: Body = await req.json().catch(() => ({}));
    const { fixtureId, homeName, awayName, kickoffISO } = body;

    if (!fixtureId) {
      return new Response(
        JSON.stringify({ reliability: "limitado", error: "fixtureId required" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const cacheKey = `ctx_${fixtureId}`;
    const cached = await cacheGet(cacheKey);
    if (cached) {
      return new Response(JSON.stringify(cached), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [lineupsRaw, oddsRaw, standingRaw, h2hRaw] = await Promise.all([
      sportsrc("lineups", fixtureId),
      sportsrc("odds", fixtureId),
      sportsrc("standing", fixtureId),
      sportsrc("h2h", fixtureId),
    ]);

    const lineupsOut = parseLineups(lineupsRaw, homeName, awayName);
    const { motivation, haveStandings } = parseStanding(standingRaw, homeName, awayName);
    const oddsOut = parseOdds(oddsRaw);
    const fatigue = parseH2HRecent(h2hRaw, homeName, awayName);

    const injuriesOut = {
      home: { count: 0, players: [], impact: "baixo" as const },
      away: { count: 0, players: [], impact: "baixo" as const },
    };

    // Movement: persistimos primeira leitura como "abertura"
    let opening: any = null;
    let movement: any = null;
    if (oddsOut && fixtureId) {
      const openKey = `odds_open_${fixtureId}`;
      try {
        const { data: openRow } = await sb()
          .from("cache_api")
          .select("dados_json")
          .eq("cache_key", openKey)
          .maybeSingle();
        if (openRow?.dados_json) {
          opening = openRow.dados_json;
        } else {
          opening = {
            home: oddsOut.home, draw: oddsOut.draw, away: oddsOut.away,
            over25: oddsOut.over25, under25: oddsOut.under25,
            capturedAt: new Date().toISOString(),
          };
          await sb().from("cache_api").upsert({
            cache_key: openKey, dados_json: opening, status_jogo: "PRE",
            ultima_atualizacao: new Date().toISOString(),
          }, { onConflict: "cache_key" });
        }
        const drift = (cur: number | null, op: number | null) => {
          if (!cur || !op) return "flat";
          const delta = (cur - op) / op;
          if (delta <= -0.07) return "down";
          if (delta >= 0.07) return "up";
          return "flat";
        };
        movement = {
          home: drift(oddsOut.home, opening.home),
          draw: drift(oddsOut.draw, opening.draw),
          away: drift(oddsOut.away, opening.away),
          over25: drift(oddsOut.over25, opening.over25),
        };
        (oddsOut as any).opening = opening;
        (oddsOut as any).movement = movement;
      } catch (e) { console.warn("opening odds persist fail", e); }
    }

    // Reliability
    const haveLineups = lineupsOut.source === "oficial";
    const haveOdds = !!oddsOut;
    const haveRecent = !!(fatigue.home || fatigue.away);
    const kickoffMs = kickoffISO ? new Date(kickoffISO).getTime() : 0;
    const hoursToKickoff = kickoffMs ? (kickoffMs - Date.now()) / 3600000 : 0;
    const lineupsExpected = hoursToKickoff <= 1.5 && hoursToKickoff >= -2;
    let score = 0;
    if (haveOdds) score += 1;
    if (haveStandings) score += 1;
    if (haveRecent) score += 1;
    if (lineupsExpected && haveLineups) score += 1;
    else if (!lineupsExpected) score += 1;

    const reliability = score >= 4 ? "completo" : score >= 2 ? "parcial" : "limitado";

    const result = {
      lineups: lineupsOut,
      injuries: injuriesOut,
      motivation,
      fatigue,
      odds: oddsOut,
      reliability,
      generatedAt: new Date().toISOString(),
      provider: "sportsrc",
    };

    await cacheSet(cacheKey, result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("match-context error", e);
    return new Response(
      JSON.stringify({ reliability: "limitado", error: String(e) }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
