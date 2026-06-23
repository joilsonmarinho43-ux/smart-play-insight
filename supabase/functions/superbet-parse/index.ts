// Superbet Connect — Parser endpoint (Fase 2)
// Usa regex/heurísticas em texto e URL. OCR/Gemini ficam para Fase 3.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { parseSuperbetPayload, PARSER_VERSION } from "../_shared/superbetParser.ts";

interface Body {
  captureId?: string;
  text?: string | null;
  sourceUrl?: string | null;
  imageBase64?: string | null;
  marketHint?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: Body = {};
  try { body = await req.json(); }
  catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const hasImage = !!body.imageBase64;
  const parsed = parseSuperbetPayload({
    text: body.text ?? null,
    sourceUrl: body.sourceUrl ?? null,
  });

  // Se veio imagem e nada de texto, sinaliza para Fase 3 (OCR)
  if (hasImage && !body.text && parsed.confidence < 0.2) {
    parsed.kind = "image";
    parsed.missingFields.push("ocr_pending");
    parsed.note = "Imagem recebida — OCR/Vision será aplicado na Fase 3.";
  }

  return new Response(JSON.stringify(parsed), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json", "X-Parser-Version": PARSER_VERSION },
  });
});
