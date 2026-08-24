import { corsHeaders } from '../_shared/cors.ts';
// AI Signal Analyst — Groq (Llama 3.3 70B) primary, Gemini 2.5 Flash fallback
// Generates short tactical reading for Telegram signals and Live Trader PRO


interface AnalystPayload {
  mode: 'telegram' | 'live';
  match: string;
  league?: string;
  minute?: number;
  score?: string;
  market?: string;
  confidence?: number;
  pressure?: { home: number; away: number };
  dangerousAttacks?: { home: number; away: number };
  shotsOnGoal?: { home: number; away: number };
  corners?: { home: number; away: number };
  possession?: { home: number; away: number };
  reason?: string;
}

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function buildPrompt(p: AnalystPayload): { system: string; user: string } {
  const isLive = p.mode === 'live' || (p.minute && p.minute > 0);
  const stats = [
    p.score && `Placar: ${p.score}`,
    p.minute && `Minuto: ${p.minute}'`,
    p.pressure && `Pressão (PI): ${p.pressure.home} x ${p.pressure.away}`,
    p.dangerousAttacks && `Ataques perigosos: ${p.dangerousAttacks.home} x ${p.dangerousAttacks.away}`,
    p.shotsOnGoal && `Chutes no gol: ${p.shotsOnGoal.home} x ${p.shotsOnGoal.away}`,
    p.corners && `Escanteios: ${p.corners.home} x ${p.corners.away}`,
    p.possession && `Posse: ${p.possession.home}% x ${p.possession.away}%`,
  ].filter(Boolean).join(' | ');

  if (p.mode === 'telegram') {
    return {
      system: 'Você é o Analista Joilson. Gere leitura tática ultra-curta (máx 240 caracteres, 2 linhas), em PT-BR, foco no mercado sugerido. Sem emojis. Sem markdown. Sem repetir placar/minuto. Direto ao ponto: o que o jogo mostra que valida a entrada.',
      user: `Jogo: ${p.match}${p.league ? ` (${p.league})` : ''}
${stats}
Mercado sugerido: ${p.market}${p.confidence ? ` (${p.confidence}%)` : ''}
${p.reason ? `Motivo: ${p.reason}` : ''}

Escreva a leitura tática (máx 240 chars):`,
    };
  }

  return {
    system: 'Você é o Analista Joilson, especialista em leitura tática ao vivo. Gere análise objetiva em PT-BR (máx 400 caracteres, 3-4 frases): cenário atual, time que pressiona, oportunidades de mercado (gols/escanteios/cartões) com base nos dados. Sem emojis. Sem markdown. Sem inventar números.',
    user: `${p.match}${p.league ? ` — ${p.league}` : ''} (ao vivo)
${stats}

Leitura tática ao vivo:`,
  };
}

async function callGroq(system: string, user: string): Promise<string | null> {
  const key = Deno.env.get('GROQ_API_KEY');
  if (!key) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        temperature: 0.4,
        max_tokens: 220,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    clearTimeout(t);
    if (!res.ok) {
      console.error('[ai-signal-analyst] Groq error:', res.status, await res.text());
      return null;
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.error('[ai-signal-analyst] Groq fail:', e);
    return null;
  }
}

async function callGemini(system: string, user: string): Promise<string | null> {
  const key = Deno.env.get('LOVABLE_API_KEY');
  if (!key) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    clearTimeout(t);
    if (!res.ok) {
      console.error('[ai-signal-analyst] Gemini error:', res.status, await res.text());
      return null;
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.error('[ai-signal-analyst] Gemini fail:', e);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const payload = await req.json() as AnalystPayload;
    if (!payload?.match || !payload?.mode) {
      return jsonResp({ ok: false, error: 'match and mode required' }, 400);
    }
    const { system, user } = buildPrompt(payload);

    let text = await callGroq(system, user);
    let source: 'groq' | 'gemini' | null = text ? 'groq' : null;
    if (!text) {
      text = await callGemini(system, user);
      source = text ? 'gemini' : null;
    }

    if (!text) return jsonResp({ ok: false, error: 'ai unavailable' }, 503);

    // Sanitize: strip markdown / quebras excessivas
    const clean = text.replace(/[*_`#>]/g, '').replace(/\n{2,}/g, '\n').trim();
    return jsonResp({ ok: true, text: clean, source });
  } catch (e) {
    console.error('[ai-signal-analyst]', e);
    return jsonResp({ ok: false, error: e instanceof Error ? e.message : 'unknown' }, 500);
  }
});
