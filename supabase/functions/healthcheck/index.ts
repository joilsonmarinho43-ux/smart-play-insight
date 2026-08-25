// ═══════════════════════════════════════════════════════════════
// healthcheck — DB / Telegram / Data Providers (SportsRC + FD.org + TSDB)
// GET /functions/v1/healthcheck
//   → { db, telegram, providers: { sportsrc, footballDataOrg, theSportsDb }, ok }
// ═══════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { getTelegramBotToken } from '../_shared/telegram.ts';
import { corsHeaders } from '../_shared/cors.ts';

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms)),
  ]);
}

async function probe(url: string, headers: Record<string, string> = {}) {
  const t0 = Date.now();
  try {
    const res = await withTimeout(fetch(url, { headers }), 8000);
    const data = await res.json().catch(() => ({}));
    return { ok: res.status >= 200 && res.status < 300, status: res.status, latency_ms: Date.now() - t0, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), latency_ms: Date.now() - t0 };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const result: any = { ok: false, db: null, telegram: null, providers: {}, ts: new Date().toISOString() };

  // DB
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { error } = await sb.from('cache_api').select('cache_key').limit(1);
    result.db = { ok: !error, error: error?.message || null };
  } catch (e) {
    result.db = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // Telegram
  try {
    const token = getTelegramBotToken();
    const r = await withTimeout(
      fetch(`https://api.telegram.org/bot${token}/getMe`).then(async (res) => ({
        status: res.status, data: await res.json().catch(() => ({})),
      })), 6000,
    );
    result.telegram = { ok: r.status === 200 && r.data?.ok === true, status: r.status, username: r.data?.result?.username || null };
  } catch (e) {
    result.telegram = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // Providers
  const sportsrcKey = Deno.env.get('SPORTSRC_API_KEY');
  result.providers.sportsrc = sportsrcKey
    ? await probe('https://api.sportsrc.org/v2/?type=account', { 'X-API-KEY': sportsrcKey })
    : { ok: false, error: 'SPORTSRC_API_KEY missing' };

  const fdoKey = Deno.env.get('FOOTBALL_DATA_ORG_KEY');
  result.providers.footballDataOrg = fdoKey
    ? await probe('https://api.football-data.org/v4/competitions', { 'X-Auth-Token': fdoKey })
    : { ok: false, error: 'FOOTBALL_DATA_ORG_KEY missing' };

  result.providers.theSportsDb = await probe('https://www.thesportsdb.com/api/v1/json/123/all_leagues.php');

  // OK se pelo menos 1 provider de dados estiver up + db + telegram
  const anyProvider = !!(result.providers.sportsrc?.ok || result.providers.footballDataOrg?.ok || result.providers.theSportsDb?.ok);
  result.ok = !!(result.db?.ok && result.telegram?.ok && anyProvider);

  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 503,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
