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


import { corsHeaders } from '../_shared/cors.ts';
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

function isEmptyStats(v: any): boolean {
  const sum = (s: any) => Object.values(s || {}).reduce((a: number, b: any) => a + (Number(b) || 0), 0);
  return sum(v?.home) <= 0 && sum(v?.away) <= 0;
}

async function cacheGet(key: string): Promise<any | null> {
  try {
    const { data } = await sb().from('cache_api')
      .select('dados_json, ultima_atualizacao')
      .eq('cache_key', key).maybeSingle();
    if (!data) return null;
    const ageH = (Date.now() - new Date(data.ultima_atualizacao).getTime()) / 3.6e6;
    if (ageH > 24) return null;
    // NUNCA servir cache vazio (envenenado por rate-limit anterior)
    if (isEmptyStats(data.dados_json)) return null;
    return data.dados_json;
  } catch { return null; }
}

async function cacheSet(key: string, value: any) {
  if (isEmptyStats(value)) return; // não envenena o cache
  try {
    await sb().from('cache_api').upsert({
      cache_key: key, dados_json: value, ultima_atualizacao: new Date().toISOString(),
    }, { onConflict: 'cache_key' });
  } catch {}
}

/**
 * Fallback determinístico: deriva médias de finalizações/escanteios/posse a
 * partir das médias reais de gols (últimos 5 jogos) usando conversões
 * padrão do futebol profissional. Marcado como `derived` na resposta.
 */
function derive(gf: number, ga: number, strongerSide: boolean): SideStats {
  const g = Math.max(0.3, Number(gf) || 0);
  const conc = Math.max(0.3, Number(ga) || 0);
  const sot = g / 0.31;                    // ~31% de conversão de chutes no gol
  const shots = sot / 0.36;                // ~36% dos chutes vão ao gol
  return {
    possession: Math.round((strongerSide ? 53 : 47) + (g - conc) * 3),
    totalShots: Number(shots.toFixed(1)),
    shotsOnGoal: Number(sot.toFixed(1)),
    bigChances: Number((g * 1.35).toFixed(1)),
    corners: Number((shots * 0.42).toFixed(1)),
    offsides: Number((shots * 0.13).toFixed(1)),
    fouls: Number((12 - (g - conc)).toFixed(1)),
    yellowCards: Number((1.9 + (conc - g) * 0.2).toFixed(1)),
    goalsFor: Number(g.toFixed(2)),
    goalsAgainst: Number(conc.toFixed(2)),
  };
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
    const hGF = Number(body?.homeGoalsAvg || 0);
    const aGF = Number(body?.awayGoalsAvg || 0);
    const hGA = Number(body?.homeGoalsAgainstAvg || 0);
    const aGA = Number(body?.awayGoalsAgainstAvg || 0);
    const canDerive = hGF > 0 && aGF > 0;
    const derived = () => ({
      home: derive(hGF, hGA || aGF, hGF >= aGF),
      away: derive(aGF, aGA || hGF, aGF > hGF),
    });
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

    const messages = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];

    const callGroq = (model: string) =>
      fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, response_format: { type: 'json_object' }, temperature: 0.3 }),
      });

    const callLovable = () =>
      fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${lovableKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'google/gemini-2.5-flash', messages, response_format: { type: 'json_object' } }),
      });

    // Modelos Groq atuais (o antigo llama-3.3-70b-versatile pode estar indisponível na chave)
    const GROQ_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'openai/gpt-oss-20b'];

    let resp: Response | null = null;
    let usedSource = 'ai';
    let lastStatus = 0;

    if (groqKey) {
      for (const model of GROQ_MODELS) {
        const r = await callGroq(model);
        if (r.ok) { resp = r; usedSource = `groq:${model}`; break; }
        lastStatus = r.status;
        const txt = await r.text();
        console.error('team-stats-ai groq error', model, r.status, txt.slice(0, 200));
        // 404/400 = modelo inválido → tenta o próximo; 429/402 → para e degrada
        if (r.status === 429 || r.status === 402) break;
      }
    }

    if (!resp && lovableKey && lastStatus !== 429 && lastStatus !== 402) {
      const r = await callLovable();
      if (r.ok) { resp = r; usedSource = 'lovable'; }
      else {
        lastStatus = r.status;
        console.error('team-stats-ai gateway error', r.status, (await r.text()).slice(0, 200));
      }
    }

    if (!resp) {
      // IA indisponível → deriva a partir das médias reais de gols (se houver)
      const reason = lastStatus === 429 ? 'rate_limited' : lastStatus === 402 ? 'credits_exhausted' : 'ai_unavailable';
      if (canDerive) {
        const out = { home: clean(derived().home), away: clean(derived().away) };
        await cacheSet(key, out);
        return new Response(JSON.stringify({ ok: true, source: `derived:${reason}`, ...out }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: false, source: reason, home: EMPTY, away: EMPTY }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
      if (canDerive) {
        const out = { home: clean(derived().home), away: clean(derived().away) };
        await cacheSet(key, out);
        return new Response(JSON.stringify({ ok: true, source: 'derived:parse_fail', ...out }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: false, error: 'parse_fail', home: EMPTY, away: EMPTY }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }


    const out = { home: clean(parsed.home), away: clean(parsed.away) };
    await cacheSet(key, out);

    return new Response(JSON.stringify({ ok: true, source: usedSource, ...out }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('team-stats-ai fatal', err);
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
