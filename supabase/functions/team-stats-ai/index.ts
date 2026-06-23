// team-stats-ai
// Usa o Lovable AI Gateway (Gemini) para PESQUISAR na internet as médias dos
// últimos 5 jogos de cada equipe e devolver um JSON estruturado pronto para
// preencher o StatsTab (posse, finalizações, chutes no gol, grandes chances,
// escanteios, impedimentos, faltas, cartões + gols pró/contra).
//
// Body: { home: string; away: string; league?: string }
// Resp: { ok, source: 'ai', home: SideStats, away: SideStats }
//
// IMPORTANTE: marca a fonte como 'ai' para a UI rotular "Estimativa IA".

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SideStats {
  possession: number;
  totalShots: number;
  shotsOnGoal: number;
  bigChances: number;
  corners: number;
  offsides: number;
  fouls: number;
  yellowCards: number;
  goalsFor: number;
  goalsAgainst: number;
}

const EMPTY: SideStats = {
  possession: 0, totalShots: 0, shotsOnGoal: 0, bigChances: 0,
  corners: 0, offsides: 0, fouls: 0, yellowCards: 0,
  goalsFor: 0, goalsAgainst: 0,
};

function sb() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

function cacheKey(home: string, away: string) {
  return `team-stats-ai:${home.toLowerCase()}::${away.toLowerCase()}`;
}

async function cacheGet(key: string): Promise<any | null> {
  try {
    const { data } = await sb().from('cache_api')
      .select('dados_json, ultima_atualizacao')
      .eq('cache_key', key).maybeSingle();
    if (!data) return null;
    const ageH = (Date.now() - new Date(data.ultima_atualizacao).getTime()) / 3.6e6;
    if (ageH > 24) return null;
    return data.dados_json;
  } catch { return null; }
}

async function cacheSet(key: string, value: any) {
  try {
    await sb().from('cache_api').upsert({
      cache_key: key, dados_json: value, ultima_atualizacao: new Date().toISOString(),
    }, { onConflict: 'cache_key' });
  } catch {}
}

function clean(s: any): SideStats {
  const n = (v: any, min = 0, max = 100) => {
    const x = Number(v);
    if (!Number.isFinite(x)) return 0;
    return Math.max(min, Math.min(max, Number(x.toFixed(2))));
  };
  return {
    possession: n(s?.possession, 0, 100),
    totalShots: n(s?.totalShots, 0, 50),
    shotsOnGoal: n(s?.shotsOnGoal, 0, 30),
    bigChances: n(s?.bigChances, 0, 15),
    corners: n(s?.corners, 0, 20),
    offsides: n(s?.offsides, 0, 15),
    fouls: n(s?.fouls, 0, 40),
    yellowCards: n(s?.yellowCards, 0, 10),
    goalsFor: n(s?.goalsFor, 0, 10),
    goalsAgainst: n(s?.goalsAgainst, 0, 10),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const home = String(body?.home || '').trim();
    const away = String(body?.away || '').trim();
    const league = String(body?.league || '').trim();
    if (!home || !away) {
      return new Response(JSON.stringify({ error: 'missing_teams' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const key = cacheKey(home, away);
    const cached = await cacheGet(key);
    if (cached) {
      return new Response(JSON.stringify({ ok: true, source: 'ai-cache', ...cached }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const groqKey = Deno.env.get('GROQ_API_KEY');
    const lovableKey = Deno.env.get('LOVABLE_API_KEY');
    if (!groqKey && !lovableKey) {
      return new Response(JSON.stringify({ error: 'missing_api_key' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const system = `Você é um analista de dados de futebol. Sua tarefa: estimar as MÉDIAS por jogo das estatísticas dos últimos 5 jogos oficiais de cada equipe, baseando-se no seu conhecimento sobre o time, a liga e o nível recente.
Devolva APENAS JSON válido (sem comentários, sem markdown) no formato:
{"home":{"possession":N,"totalShots":N,"shotsOnGoal":N,"bigChances":N,"corners":N,"offsides":N,"fouls":N,"yellowCards":N,"goalsFor":N,"goalsAgainst":N},"away":{...mesma estrutura...}}
- possession em % (0-100), as outras como média decimal por jogo.
- Use valores realistas (ex: corners 3-7, totalShots 8-18, shotsOnGoal 2-6, fouls 8-15, yellowCards 1-3).
- A soma de posse home+away NÃO precisa ser 100 (são jogos diferentes).`;

    const user = `Partida: ${home} vs ${away}${league ? ` (${league})` : ''}.
Forneça as médias dos últimos 5 jogos OFICIAIS de cada equipe (qualquer competição).`;

    let resp: Response;
    let usedSource = 'ai';

    if (groqKey) {
      usedSource = 'groq';
      resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.3,
        }),
      });
    } else {
      resp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${lovableKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          response_format: { type: 'json_object' },
        }),
      });
    }

    if (resp.status === 429) {
      return new Response(JSON.stringify({ error: 'rate_limited' }), {
        status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (resp.status === 402) {
      return new Response(JSON.stringify({ error: 'credits_exhausted' }), {
        status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!resp.ok) {
      const txt = await resp.text();
      console.error('team-stats-ai gateway error', resp.status, txt);
      return new Response(JSON.stringify({ error: 'ai_error', status: resp.status }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await resp.json();
    const raw = data?.choices?.[0]?.message?.content || '';
    let parsed: any = null;
    try { parsed = JSON.parse(raw); } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
    }
    if (!parsed) {
      console.warn('team-stats-ai parse fail', String(raw).slice(0, 300));
      return new Response(JSON.stringify({ ok: false, error: 'parse_fail', home: EMPTY, away: EMPTY }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const out = { home: clean(parsed.home), away: clean(parsed.away) };
    await cacheSet(key, out);

    return new Response(JSON.stringify({ ok: true, source: 'ai', ...out }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('team-stats-ai fatal', err);
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
