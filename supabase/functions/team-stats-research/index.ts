import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders } from '../_shared/cors.ts';

const url = Deno.env.get('SUPABASE_URL') || '';
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const key = Deno.env.get('GEMINI_API_KEY') || '';
const fields = ['possession', 'xG', 'totalShots', 'shotsOnGoal', 'bigChances', 'corners', 'offsides', 'fouls', 'yellowCards'] as const;
type Field = typeof fields[number];
type Item = { value: number; sample: number; sourceUrl: string; sourceName: string; observedAt: string };

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const canonical = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const bounds: Record<Field, number> = { possession: 100, xG: 15, totalShots: 60, shotsOnGoal: 40, bigChances: 30, corners: 35, offsides: 25, fouls: 50, yellowCards: 20 };

function extract(raw: any, grounded: Set<string>, now: string) {
  const output: Record<string, Record<string, Item>> = { home: {}, away: {} };
  for (const side of ['home', 'away'] as const) {
    for (const field of fields) {
      const item = raw?.[side]?.[field];
      const value = item?.value, sample = item?.sample;
      const sourceUrl = String(item?.sourceUrl || '').trim();
      let parsed: URL;
      try { parsed = new URL(sourceUrl); } catch { continue; }
      if (parsed.protocol !== 'https:' || !grounded.has(parsed.href) ||
          typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > bounds[field] ||
          !Number.isInteger(sample) || sample < 1 || sample > 5) continue;
      output[side][field] = { value, sample, sourceUrl: parsed.href, sourceName: parsed.hostname, observedAt: now };
    }
  }
  return output;
}

async function research(home: string, away: string, league: string, kickoff: string) {
  const prompt = `Pesquise na web os últimos até 5 jogos CONCLUÍDOS de ${home} e ${away}, da partida ${home} x ${away}, ${league}, início ${kickoff}. Para cada equipe, retorne somente médias aritméticas de estatísticas publicadas explicitamente nas páginas consultadas: possession (%), xG, totalShots, shotsOnGoal, bigChances, corners, offsides, fouls, yellowCards. Cada campo deve ser {"value":número,"sample":quantidade de jogos medidos,"sourceUrl":"URL HTTPS exata da fonte"}. Se um campo não tiver valores observados, use null. Não deduza de placares, não estime e não invente. Responda JSON {"home":{...},"away":{...}}.`;
  for (const model of ['gemini-2.5-pro', 'gemini-2.5-flash']) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      let response: Response;
      try {
        response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
          method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0 } }),
        });
      } finally { clearTimeout(timer); }
      if (!response.ok) { if (response.status === 404 || response.status === 400) continue; break; }
      const data = await response.json();
      const candidate = data?.candidates?.[0];
      const grounded = new Set<string>((candidate?.groundingMetadata?.groundingChunks || []).flatMap((x: any) => {
        try { return [new URL(x?.web?.uri).href]; } catch { return []; }
      }));
      if (!grounded.size) continue;
      const text = (candidate?.content?.parts || []).map((x: any) => x?.text || '').join('');
      const start = text.indexOf('{'), end = text.lastIndexOf('}');
      if (start < 0 || end <= start) continue;
      const parsed = JSON.parse(text.slice(start, end + 1));
      return { stats: extract(parsed, grounded, new Date().toISOString()), provider: model, groundingCount: grounded.size };
    } catch (error) { console.warn('[team-stats-research] provider unavailable', String(error)); }
  }
  return { stats: { home: {}, away: {} }, provider: 'unavailable', groundingCount: 0 };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
  if (!url || !service) return json({ ok: false, error: 'SERVICE_UNAVAILABLE' }, 503);
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() || '';
  const sb = createClient(url, service, { auth: { persistSession: false } });
  const { data: { user }, error } = token ? await sb.auth.getUser(token) : { data: { user: null }, error: null };
  if (error || !user) return json({ ok: false, error: 'AUTH_REQUIRED' }, 401);
  const body = await req.json().catch(() => ({}));
  const home = String(body.home || '').trim().slice(0, 100);
  const away = String(body.away || '').trim().slice(0, 100);
  const league = String(body.league || '').trim().slice(0, 100);
  const kickoff = String(body.kickoff || '').trim().slice(0, 35);
  if (!home || !away || home === away) return json({ ok: false, error: 'TEAMS_REQUIRED' }, 400);
  const cacheKey = `team-stats-research:v1:${canonical(home)}:${canonical(away)}:${canonical(league)}`;
  const { data: cached } = await sb.from('cache_api').select('dados_json,ultima_atualizacao').eq('cache_key', cacheKey).maybeSingle();
  if (cached && Date.now() - new Date(cached.ultima_atualizacao).getTime() < 60 * 60 * 1000) return json(cached.dados_json);
  const { data: allowed, error: rateError } = await sb.rpc('check_rate_limit', {
    _bucket: 'team-stats-research', _subject: user.id, _max_calls: 20, _window_seconds: 3600,
  });
  if (rateError) return json({ ok: false, error: 'RATE_LIMIT_UNAVAILABLE' }, 503);
  if (allowed === false) return json({ ok: false, error: 'RATE_LIMITED' }, 429);
  if (!key) return json({ ok: true, stats: { home: {}, away: {} }, status: 'AI_UNAVAILABLE' });
  const result = await research(home, away, league, kickoff);
  const count = Object.keys(result.stats.home).length + Object.keys(result.stats.away).length;
  const payload = { ok: true, status: count ? 'GROUNDED_STATS' : 'NO_VERIFIED_STATS', ...result };
  await sb.from('cache_api').upsert({ cache_key: cacheKey, dados_json: payload, status_jogo: 'RESEARCH', ultima_atualizacao: new Date().toISOString() }, { onConflict: 'cache_key' });
  return json(payload);
});
