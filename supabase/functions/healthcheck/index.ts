// ═══════════════════════════════════════════════════════════════
// healthcheck — DB / Telegram / API-Football
// GET /functions/v1/healthcheck  → { db, telegram, api, ok }
// ═══════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getTelegramBotToken } from '../_shared/telegram.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms)),
  ]);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const result: any = { ok: false, db: null, telegram: null, api: null, ts: new Date().toISOString() };

  // DB
  try {
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { error } = await sb.from('cache_api').select('cache_key').limit(1);
    result.db = { ok: !error, error: error?.message || null };
  } catch (e) {
    result.db = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // Telegram (getMe — leve, sem enviar nada)
  try {
    const token = getTelegramBotToken();
    const r = await withTimeout(
      fetch(`https://api.telegram.org/bot${token}/getMe`).then(async (res) => ({
        status: res.status,
        data: await res.json().catch(() => ({})),
      })),
      6000,
    );
    result.telegram = { ok: r.status === 200 && r.data?.ok === true, status: r.status, username: r.data?.result?.username || null };
  } catch (e) {
    result.telegram = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // API-Football (status)
  try {
    const key = Deno.env.get('API_FUTEBOL_KEY');
    if (!key) {
      result.api = { ok: false, error: 'API_FUTEBOL_KEY missing' };
    } else {
      const r = await withTimeout(
        fetch('https://v3.football.api-sports.io/status', { headers: { 'x-apisports-key': key } }).then(async (res) => ({
          status: res.status,
          data: await res.json().catch(() => ({})),
        })),
        8000,
      );
      const requests = r.data?.response?.requests;
      result.api = {
        ok: r.status === 200 && !!r.data?.response,
        status: r.status,
        used: requests?.current ?? null,
        limit: requests?.limit_day ?? null,
      };
    }
  } catch (e) {
    result.api = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  result.ok = !!(result.db?.ok && result.telegram?.ok && result.api?.ok);
  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 503,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
