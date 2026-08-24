// TEMP diagnostic — probes SportsRC v2 endpoints. Never logs/returns the API key.
import { corsHeaders } from "../_shared/cors.ts";

const BASE = "https://api.sportsrc.org/v2";
const KEY = Deno.env.get("SPORTSRC_API_KEY") || "";

async function probe(params: Record<string, string>) {
  const url = new URL(BASE + "/");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const t0 = Date.now();
  try {
    const res = await fetch(url.toString(), {
      headers: { "X-API-KEY": KEY, Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    const json = await res.json().catch(() => null);
    const groups = Array.isArray(json?.data) ? json.data : [];
    const statuses: Record<string, number> = {};
    let first: any = null;
    for (const g of groups) {
      for (const m of (g?.matches || [])) {
        const s = `${m?.status}|${m?.status_detail}`;
        statuses[s] = (statuses[s] || 0) + 1;
        if (!first) first = m;
      }
    }
    return {
      params, status: res.status, ms: Date.now() - t0,
      filters: json?.filters, total: json?.total_matches, statuses,
      firstKeys: first ? Object.keys(first) : null,
      minute: first?.minute ?? null,
    };
  } catch (e) {
    return { params, status: 0, ms: Date.now() - t0, error: String(e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const today = new Date().toISOString().slice(0, 10);
  const results = await Promise.all([
    probe({ type: "matches", status: "live", date: today }),
    probe({ type: "matches", date: today }),
    probe({ type: "matches", status: "live" }),
    probe({ type: "matches", date: "live" }),
  ]);
  return new Response(JSON.stringify({ hasKey: KEY.length > 0, today, results }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
