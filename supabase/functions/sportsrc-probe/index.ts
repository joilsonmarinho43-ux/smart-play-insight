// TEMP diagnostic — probes SportsRC v2 endpoints. Never logs/returns the API key.
import { corsHeaders } from "../_shared/cors.ts";

const BASE = "https://api.sportsrc.org/v2";
const KEY = Deno.env.get("SPORTSRC_API_KEY") || "";

async function probe(path: string, params: Record<string, string>) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const t0 = Date.now();
  try {
    const res = await fetch(url.toString(), {
      headers: { "X-API-KEY": KEY, Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* noop */ }
    return {
      path, params, status: res.status, ms: Date.now() - t0,
      keys: json && typeof json === "object" ? Object.keys(json).slice(0, 10) : null,
      dataType: Array.isArray(json?.data) ? `array(${json.data.length})` : typeof json?.data,
      sample: JSON.stringify(json).slice(0, 700),
    };
  } catch (e) {
    return { path, params, status: 0, ms: Date.now() - t0, error: String(e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const today = new Date().toISOString().slice(0, 10);
  const results = await Promise.all([
    probe("/", { type: "matches", status: "live" }),
    probe("/", { type: "matches", date: today }),
    probe("/", { type: "live" }),
    probe("/matches", { status: "live" }),
    probe("/matches/live", {}),
    probe("/live", {}),
    probe("/", { type: "matches" }),
  ]);
  return new Response(JSON.stringify({ hasKey: KEY.length > 0, results }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
