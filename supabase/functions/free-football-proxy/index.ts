// Proxy unificado para APIs gratuitas de futebol.
// Provedores suportados: 'football-data-org', 'thesportsdb', 'sportsrc'.
// Centraliza chave + CORS + cache COMPARTILHADO em DB (cache_api).
//
// Estratégia anti-rate-limit (SportsRC FREE = 1000 req/dia):
// 1) Para sportsrc matches por data, usa cache_api com TTL 6h.
// 2) Se upstream falhar (limite, 4xx, 5xx, timeout), devolve o último
//    snapshot bom (stale) com served_from_stale=true em vez de erro.
// 3) Cache compartilhado entre TODOS os usuários — uma única chamada
//    por dia abastece o app inteiro.

import { corsHeaders } from '../_shared/cors.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const FD_KEY = Deno.env.get('FOOTBALL_DATA_ORG_KEY') || '';
const SPORTSRC_KEY = Deno.env.get('SPORTSRC_API_KEY') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const sb = SUPABASE_URL && SERVICE_ROLE
  ? createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })
  : null;

const FRESH_TTL_MS = 1000 * 60 * 60 * 6; // 6h fresh
const STALE_MAX_MS = 1000 * 60 * 60 * 24 * 7; // 7d stale absoluto

interface ProxyBody {
  provider: 'football-data-org' | 'thesportsdb' | 'sportsrc' | 'espn';
  path: string;
  params?: Record<string, string>;
}

function buildUrl(provider: string, path: string, params?: Record<string, string>) {
  let base = '';
  if (provider === 'football-data-org') base = 'https://api.football-data.org';
  else if (provider === 'thesportsdb') base = 'https://www.thesportsdb.com/api/v1/json/123';
  else if (provider === 'sportsrc') base = 'https://api.sportsrc.org/v2';
  else if (provider === 'espn') base = 'https://site.api.espn.com';
  else throw new Error('unknown_provider');
  const url = new URL(base + (path || '/'));
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  return url.toString();
}

function cacheKeyFor(body: ProxyBody): string | null {
  // Só cacheia endpoints idempotentes de listagem por data
  if (body.provider === 'sportsrc' && body.params?.type === 'matches' && body.params?.date) {
    return `sportsrc:matches:${body.params.date}`;
  }
  if (body.provider === 'football-data-org' && body.params?.dateFrom && body.params?.dateTo) {
    return `fdo:matches:${body.params.dateFrom}:${body.params.dateTo}`;
  }
  if (body.provider === 'espn' && body.params?.dates) {
    return `espn:scoreboard:${body.params.dates}`;
  }
  if (body.provider === 'thesportsdb' && (body.path || '').includes('eventsday.php') && body.params?.d) {
    return `tsdb:eventsday:${body.params.d}`;
  }
  return null;
}

async function readCache(key: string): Promise<{ data: any; ageMs: number } | null> {
  if (!sb) return null;
  try {
    const { data, error } = await sb
      .from('cache_api')
      .select('dados_json, ultima_atualizacao')
      .eq('cache_key', key)
      .maybeSingle();
    if (error || !data) return null;
    const ts = new Date(data.ultima_atualizacao).getTime();
    return { data: data.dados_json, ageMs: Date.now() - ts };
  } catch { return null; }
}

async function writeCache(key: string, payload: any): Promise<void> {
  if (!sb) return;
  try {
    await sb.from('cache_api').upsert({
      cache_key: key,
      dados_json: payload,
      status_jogo: 'cached',
      ultima_atualizacao: new Date().toISOString(),
    }, { onConflict: 'cache_key' });
  } catch { /* noop */ }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const t0 = Date.now();

  try {
    const body = (await req.json()) as ProxyBody;
    if (!body?.provider) {
      return new Response(JSON.stringify({ error: 'invalid_body' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const cacheKey = cacheKeyFor(body);

    // 1) Cache HIT fresco — devolve direto, sem bater no upstream
    if (cacheKey) {
      const cached = await readCache(cacheKey);
      if (cached && cached.ageMs < FRESH_TTL_MS) {
        return new Response(JSON.stringify({
          ok: true, data: cached.data, provider: body.provider,
          latency_ms: Date.now() - t0, cache: 'fresh', age_ms: cached.ageMs,
        }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    const url = buildUrl(body.provider, body.path || '/', body.params);
    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (body.provider === 'football-data-org') {
      if (!FD_KEY) {
        return new Response(JSON.stringify({ error: 'missing_key', provider: body.provider }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      headers['X-Auth-Token'] = FD_KEY;
    } else if (body.provider === 'sportsrc') {
      if (!SPORTSRC_KEY) {
        return new Response(JSON.stringify({ error: 'missing_key', provider: body.provider }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      headers['X-API-KEY'] = SPORTSRC_KEY;
    } else if (body.provider === 'espn') {
      // ESPN bloqueia requisições sem cara de navegador (403 Access Denied).
      headers['User-Agent'] =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
      headers['Accept-Language'] = 'en-US,en;q=0.9';
      headers['Referer'] = 'https://www.espn.com/';
    }

    let upstreamOk = false;
    let upstreamJson: any = null;
    let upstreamStatus = 0;
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(url, { headers, signal: ctrl.signal });
      clearTimeout(to);
      upstreamStatus = res.status;
      const text = await res.text();
      try { upstreamJson = JSON.parse(text); } catch { upstreamJson = { raw: text }; }
      upstreamOk = res.ok;
    } catch (e: any) {
      upstreamJson = { error: 'fetch_exception', message: e?.message || String(e) };
    }

    // 2) Upstream OK — grava cache e devolve
    if (upstreamOk) {
      if (cacheKey) await writeCache(cacheKey, upstreamJson);
      return new Response(JSON.stringify({
        ok: true, data: upstreamJson, provider: body.provider,
        latency_ms: Date.now() - t0, cache: 'miss',
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 3) Upstream falhou — tenta stale para não quebrar UI
    if (cacheKey) {
      const cached = await readCache(cacheKey);
      if (cached && cached.ageMs < STALE_MAX_MS) {
        console.warn(`[proxy] upstream_${upstreamStatus || 'fail'} → serving stale (age=${Math.round(cached.ageMs / 60000)}min) key=${cacheKey}`);
        return new Response(JSON.stringify({
          ok: true, data: cached.data, provider: body.provider,
          latency_ms: Date.now() - t0, cache: 'stale',
          served_from_stale: true, upstream_status: upstreamStatus, age_ms: cached.ageMs,
        }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    return new Response(JSON.stringify({
      error: 'upstream_error', status: upstreamStatus, body: upstreamJson,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'proxy_exception', message: err?.message || String(err) }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
