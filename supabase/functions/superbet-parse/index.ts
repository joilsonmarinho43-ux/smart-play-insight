// Superbet Connect — parser stub (Fase 1)
// Recebe { captureId, text?, sourceUrl?, imageBase64?, marketHint? } e devolve
// um ParsedCapturePayload com campos detectados de forma muito superficial.
// As fases 2/3 vão substituir esta heurística por regex + OCR + Gemini.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const PARSER_VERSION = 'v0.1.0-stub';

interface Body {
  captureId?: string;
  text?: string | null;
  sourceUrl?: string | null;
  imageBase64?: string | null;
  marketHint?: string | null;
}

function detectKind(b: Body): 'text' | 'url' | 'image' | 'mixed' {
  const has = { t: !!b.text, u: !!b.sourceUrl, i: !!b.imageBase64 };
  const count = Number(has.t) + Number(has.u) + Number(has.i);
  if (count > 1) return 'mixed';
  if (has.i) return 'image';
  if (has.u) return 'url';
  return 'text';
}

function quickTeamGuess(text: string | null | undefined): { home?: string; away?: string } {
  if (!text) return {};
  // procura padrões "X vs Y", "X x Y", "X - Y"
  const m = text.match(/([A-ZÀ-Ÿ][\wÀ-ÿ.\- ]{2,30})\s+(?:vs|x|×|-)\s+([A-ZÀ-Ÿ][\wÀ-ÿ.\- ]{2,30})/i);
  if (!m) return {};
  return { home: m[1].trim(), away: m[2].trim() };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body: Body = {};
  try { body = await req.json(); }
  catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const kind = detectKind(body);
  const match = quickTeamGuess(body.text ?? body.sourceUrl ?? null);
  const missing: string[] = [];
  if (!match.home || !match.away) missing.push('teams');
  if (!body.text && !body.imageBase64) missing.push('payload');

  // Fase 1: confiança fixa baixa — só sinaliza que recebemos o input
  const confidence = match.home && match.away ? 0.35 : 0.1;

  const payload = {
    kind,
    match,
    confidence,
    parserVersion: PARSER_VERSION,
    missingFields: missing,
    note: 'Parser stub. Implementação real (regex + OCR + Gemini) chega na Fase 2/3.',
  };

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
