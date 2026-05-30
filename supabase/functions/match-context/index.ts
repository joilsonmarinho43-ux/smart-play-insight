import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BASE_URL = "https://v3.football.api-sports.io";
const CACHE_TTL_MS = 8 * 60 * 1000; // 8 min — odds precisam estar frescas

let _sb: ReturnType<typeof createClient> | null = null;
function sb() {
  if (_sb) return _sb;
  const url = Deno.env.get("SUPABASE_URL")!;
  const sk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  _sb = createClient(url, sk);
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
  } catch {
    return null;
  }
}

async function cacheSet(key: string, value: any) {
  try {
    await sb().from("cache_api").upsert({
      cache_key: key,
      dados_json: value,
      status_jogo: "PRE",
      ultima_atualizacao: new Date().toISOString(),
    });
  } catch (e) {
    console.error("cacheSet", e);
  }
}

// Cache de odds:
//  - Com odds disponíveis → 24h (preserva cota)
//  - Resposta vazia (jogo distante, casas ainda não abriram mercado) → 2h
//    para tentar novamente logo, sem consumir muita cota.
// Odds TTL alinhado ao TTL do contexto (8 min) para permitir detecção real de drift.
// Empty stays at 2h para não desperdiçar cota em jogos distantes sem mercado.
const ODDS_TTL_FULL_MS = 8 * 60 * 1000;
const ODDS_TTL_EMPTY_MS = 2 * 60 * 60 * 1000;
async function getOddsCached(fixtureId: number, apiKey: string) {
  const key = `odds_day_${fixtureId}`;
  try {
    const { data } = await sb()
      .from("cache_api")
      .select("dados_json, ultima_atualizacao")
      .eq("cache_key", key)
      .maybeSingle();
    if (data) {
      const age = Date.now() - new Date(data.ultima_atualizacao).getTime();
      const isEmpty = Array.isArray(data.dados_json) && data.dados_json.length === 0;
      const ttl = isEmpty ? ODDS_TTL_EMPTY_MS : ODDS_TTL_FULL_MS;
      if (age < ttl) return data.dados_json;
    }
  } catch {}
  const fresh = await apiGet(`odds?fixture=${fixtureId}`, apiKey);
  if (fresh) {
    try {
      await sb().from("cache_api").upsert({
        cache_key: key,
        dados_json: fresh,
        status_jogo: "PRE",
        ultima_atualizacao: new Date().toISOString(),
      });
    } catch (e) {
      console.warn("odds cache set fail", e);
    }
  }
  return fresh;
}

async function apiGet(path: string, apiKey: string): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${BASE_URL}/${path}`, {
      headers: { "x-apisports-key": apiKey },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.response ?? null;
  } catch (e) {
    console.warn("apiGet fail", path, String(e));
    return null;
  } finally {
    clearTimeout(t);
  }
}

interface Body {
  fixtureId?: number;
  leagueId?: number;
  season?: number;
  homeId?: number;
  awayId?: number;
  homeName?: string;
  awayName?: string;
  kickoffISO?: string;
}

function daysBetween(a: Date, b: Date) {
  return (a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24);
}

function classifyInjuryImpact(items: any[]): "baixo" | "médio" | "alto" {
  if (!items || items.length === 0) return "baixo";
  const keyPositions = items.filter((p) => {
    const pos = (p?.player?.position || "").toLowerCase();
    return pos === "attacker" || pos === "midfielder" || pos === "goalkeeper" || pos === "defender";
  });
  // Defensores em massa também desestruturam — peso maior para 3+ defensores
  const defenders = items.filter((p) => (p?.player?.position || "").toLowerCase() === "defender").length;
  if (keyPositions.length >= 3 || defenders >= 3) return "alto";
  if (keyPositions.length >= 1 || items.length >= 2) return "médio";
  return "baixo";
}

function summarizeFatigue(recent: any[], teamId: number) {
  if (!recent || recent.length === 0)
    return { gamesLast10d: 0, restDays: null as number | null };
  const now = new Date();
  const last10 = recent.filter((g) => {
    const d = new Date(g?.fixture?.date);
    return daysBetween(now, d) <= 10 && daysBetween(now, d) >= 0;
  });
  const sorted = [...recent].sort(
    (a, b) =>
      new Date(b?.fixture?.date).getTime() -
      new Date(a?.fixture?.date).getTime(),
  );
  const lastGame = sorted[0]?.fixture?.date
    ? new Date(sorted[0].fixture.date)
    : null;
  const restDays = lastGame
    ? Math.max(0, Math.round(daysBetween(now, lastGame)))
    : null;
  return { gamesLast10d: last10.length, restDays };
}

function inferMotivation(
  standings: any[],
  teamId: number,
  totalTeams: number,
): { stake: string; rank: number | null } {
  if (!standings || standings.length === 0)
    return { stake: "meio-tabela", rank: null };
  const row = standings.find((s: any) => s?.team?.id === teamId);
  if (!row) return { stake: "meio-tabela", rank: null };
  const rank = row.rank as number;
  const total = totalTeams || standings.length;
  if (rank <= 4) return { stake: "disputa por título", rank };
  if (rank <= 6) return { stake: "classificação continental", rank };
  if (rank >= total - 3) return { stake: "luta contra rebaixamento", rank };
  return { stake: "meio-tabela", rank };
}

function summarizeOdds(oddsResp: any[]) {
  if (!oddsResp || oddsResp.length === 0) return null;
  const bookmakers = oddsResp[0]?.bookmakers || [];
  if (!bookmakers.length) return null;

  const parseVal = (bet: any, label: string) => {
    const raw = bet?.values?.find((v: any) => v.value === label)?.odd;
    const n = Number(raw);
    return Number.isFinite(n) && n > 1 ? n : null;
  };

  const collect = {
    home: [] as number[], draw: [] as number[], away: [] as number[],
    over25: [] as number[], under25: [] as number[],
    bttsYes: [] as number[], bttsNo: [] as number[],
  };
  const bookieNames: string[] = [];

  for (const bk of bookmakers) {
    bookieNames.push(bk?.name || "bookmaker");
    const mw = bk.bets?.find((b: any) => b.id === 1 || /Match Winner/i.test(b.name));
    const ou = bk.bets?.find((b: any) => b.id === 5 || /Goals Over\/Under/i.test(b.name));
    const bt = bk.bets?.find((b: any) => /Both Teams/i.test(b.name || ""));
    const pushIf = (arr: number[], v: number | null) => { if (v) arr.push(v); };
    pushIf(collect.home, parseVal(mw, "Home"));
    pushIf(collect.draw, parseVal(mw, "Draw"));
    pushIf(collect.away, parseVal(mw, "Away"));
    pushIf(collect.over25, parseVal(ou, "Over 2.5"));
    pushIf(collect.under25, parseVal(ou, "Under 2.5"));
    pushIf(collect.bttsYes, parseVal(bt, "Yes"));
    pushIf(collect.bttsNo, parseVal(bt, "No"));
  }

  const avg = (a: number[]) =>
    a.length ? Math.round((a.reduce((s, v) => s + v, 0) / a.length) * 100) / 100 : null;

  const count = bookmakers.length;
  return {
    home: avg(collect.home),
    draw: avg(collect.draw),
    away: avg(collect.away),
    over25: avg(collect.over25),
    under25: avg(collect.under25),
    bttsYes: avg(collect.bttsYes),
    bttsNo: avg(collect.bttsNo),
    meta: {
      bookmakers: count,
      sourceLabel: count > 1 ? `Média de ${count} casas` : (bookieNames[0] || "bookmaker"),
      primaryBookmaker: bookieNames[0] || null,
    },
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  try {
    const body: Body = await req.json().catch(() => ({}));
    const { fixtureId, leagueId, season, homeId, awayId, kickoffISO } = body;

    if (!fixtureId) {
      return new Response(
        JSON.stringify({ error: "fixtureId required", reliability: "limitado" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const cacheKey = `ctx_${fixtureId}`;
    const cached = await cacheGet(cacheKey);
    if (cached) {
      return new Response(JSON.stringify(cached), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("API_FUTEBOL_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ reliability: "limitado", error: "no_api_key" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Calls em paralelo
    const [lineups, injuries, odds, standings, hRecent, aRecent] =
      await Promise.all([
        apiGet(`fixtures/lineups?fixture=${fixtureId}`, apiKey),
        apiGet(`injuries?fixture=${fixtureId}`, apiKey),
        getOddsCached(fixtureId!, apiKey),
        leagueId && season
          ? apiGet(`standings?league=${leagueId}&season=${season}`, apiKey)
          : Promise.resolve(null),
        homeId
          ? apiGet(`fixtures?team=${homeId}&last=5`, apiKey)
          : Promise.resolve(null),
        awayId
          ? apiGet(`fixtures?team=${awayId}&last=5`, apiKey)
          : Promise.resolve(null),
      ]);

    // Lineups
    const homeLineup = lineups?.find((l: any) => l?.team?.id === homeId);
    const awayLineup = lineups?.find((l: any) => l?.team?.id === awayId);
    const lineupsOut = {
      home: {
        formation: homeLineup?.formation || null,
        coach: homeLineup?.coach?.name || null,
        confirmed: !!homeLineup,
      },
      away: {
        formation: awayLineup?.formation || null,
        coach: awayLineup?.coach?.name || null,
        confirmed: !!awayLineup,
      },
      source: lineups && lineups.length ? "oficial" : "estimado",
    };

    // Injuries
    const hInjuries = (injuries || []).filter(
      (i: any) => i?.team?.id === homeId,
    );
    const aInjuries = (injuries || []).filter(
      (i: any) => i?.team?.id === awayId,
    );
    const injuriesOut = {
      home: {
        count: hInjuries.length,
        players: hInjuries.slice(0, 5).map((i: any) => ({
          name: i?.player?.name,
          reason: i?.player?.type ?? i?.player?.reason ?? null,
          position: i?.player?.position,
        })),
        impact: classifyInjuryImpact(hInjuries),
      },
      away: {
        count: aInjuries.length,
        players: aInjuries.slice(0, 5).map((i: any) => ({
          name: i?.player?.name,
          reason: i?.player?.reason,
          position: i?.player?.position,
        })),
        impact: classifyInjuryImpact(aInjuries),
      },
    };

    // Standings & motivation
    const table = standings?.[0]?.league?.standings?.[0] || [];
    const totalTeams = table.length;
    const motivation = {
      home: homeId
        ? inferMotivation(table, homeId, totalTeams)
        : { stake: "desconhecida", rank: null },
      away: awayId
        ? inferMotivation(table, awayId, totalTeams)
        : { stake: "desconhecida", rank: null },
    };

    // Fatigue
    const fatigue = {
      home: homeId ? summarizeFatigue(hRecent || [], homeId) : null,
      away: awayId ? summarizeFatigue(aRecent || [], awayId) : null,
    };

    // Odds (atuais — média de N casas)
    const oddsOut = summarizeOdds(odds || []);

    // Movimento: persistimos primeira leitura como "abertura"
    let movement: any = null;
    let opening: any = null;
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
            cache_key: openKey,
            dados_json: opening,
            status_jogo: "PRE",
            ultima_atualizacao: new Date().toISOString(),
          });
        }
        const drift = (cur: number | null, op: number | null) => {
          if (!cur || !op) return "flat";
          const delta = (cur - op) / op;
          if (delta <= -0.07) return "down";   // odd caiu = confiança subiu
          if (delta >= 0.07) return "up";      // odd subiu = confiança caiu
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
      } catch (e) {
        console.warn("opening odds persist fail", e);
      }
    }

    // Reliability — considera distância do kickoff (escalações só saem ~1h antes)
    const haveLineups = !!homeLineup || !!awayLineup;
    const haveOdds = !!oddsOut;
    const haveStandings = table.length > 0;
    const haveInjuries = injuries !== null; // chamada respondeu (mesmo que vazia)
    const haveRecent = (hRecent?.length ?? 0) > 0 && (aRecent?.length ?? 0) > 0;

    const kickoffMs = kickoffISO ? new Date(kickoffISO).getTime() : 0;
    const hoursToKickoff = kickoffMs ? (kickoffMs - Date.now()) / 3600000 : 0;
    const lineupsExpected = hoursToKickoff <= 1.5 && hoursToKickoff >= -2;

    let score = 0;
    if (haveOdds) score += 1;
    if (haveStandings) score += 1;
    if (haveRecent) score += 1;
    if (haveInjuries) score += 1;
    if (lineupsExpected && haveLineups) score += 1;
    else if (!lineupsExpected) score += 1; // não penaliza ausência de escalação cedo

    const reliability =
      score >= 4 ? "completo" : score >= 2 ? "parcial" : "limitado";

    const result = {
      lineups: lineupsOut,
      injuries: injuriesOut,
      motivation,
      fatigue,
      odds: oddsOut,
      reliability,
      generatedAt: new Date().toISOString(),
    };

    await cacheSet(cacheKey, result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("match-context error", e);
    return new Response(
      JSON.stringify({
        reliability: "limitado",
        error: String(e),
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
