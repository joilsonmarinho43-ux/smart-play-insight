// Proxy unificado para APIs gratuitas de futebol.
// Provedores suportados: 'football-data-org', 'thesportsdb'.
// Centraliza chave + CORS + cache curto em memória por request.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const FD_KEY = Deno.env.get('FOOTBALL_DATA_ORG_KEY') || '';
const SPORTSRC_KEY = Deno.env.get('SPORTSRC_API_KEY') || '';

interface ProxyBody {
  provider: 'football-data-org' | 'thesportsdb' | 'sportsrc';
  path: string;            // ex: '/v4/matches' (FD), '/' (sportsrc)
  params?: Record<string, string>;
}

function buildUrl(provider: string, path: string, params?: Record<string, string>) {
  let base = '';
  if (provider === 'football-data-org') base = 'https://api.football-data.org';
  else if (provider === 'thesportsdb') base = 'https://www.thesportsdb.com/api/v1/json/123';
  else if (provider === 'sportsrc') base = 'https://api.sportsrc.org/v2';
  else throw new Error('unknown_provider');
  const url = new URL(base + (path || '/'));
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  return url.toString();
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
    }

    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(url, { headers, signal: ctrl.signal });
    clearTimeout(to);
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }

    if (!res.ok) {
      return new Response(JSON.stringify({ error: 'upstream_error', status: res.status, body: json }), {
        status: 200, // não propaga 4xx pra invoke estourar
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true, data: json }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'proxy_exception', message: err?.message || String(err) }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
