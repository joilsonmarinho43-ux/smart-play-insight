// Superbet Connect — Parser endpoint (Fase 3)
// Pipeline resiliente:
//  Nível 1: URL estruturada (parseSuperbetUrl)
//  Nível 2: Regex/heurística sobre texto (cliente + OCR Tesseract)
//  Nível 3: Gemini Vision fallback (quando imagem chega com OCR baixa
//           confiança ou texto vazio)
//  Nível 4: SportsRC fica como complemento externo (não chamado aqui)

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { parseSuperbetPayload, PARSER_VERSION } from "../_shared/superbetParser.ts";

interface Body {
  captureId?: string;
  text?: string | null;
  sourceUrl?: string | null;
  imageBase64?: string | null;
  marketHint?: string | null;
  ocrConfidence?: number | null;
}

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const VISION_MODEL = "google/gemini-2.5-flash";
const VISION_CONFIDENCE_FLOOR = 0.4;
const OCR_TEXT_CONFIDENCE_FLOOR = 55; // %

async function runVisionFallback(imageBase64: string): Promise<{ text: string; note: string } | null> {
  if (!LOVABLE_API_KEY) return null;
  try {
    const dataUrl = imageBase64.startsWith("data:")
      ? imageBase64
      : `data:image/png;base64,${imageBase64}`;
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [
          {
            role: "system",
            content:
              "Você é um extrator de dados esportivos da Superbet. Devolva APENAS texto plano " +
              "com cada métrica/odd em uma linha, no formato 'Rótulo: valor casa | valor fora' " +
              "ou 'Mercado Seleção: cotação'. Não invente dados ausentes.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Extraia times, placar, minuto, odds (1X2, Over/Under, BTTS, escanteios), estatísticas (posse, finalizações, escanteios, cartões, faltas, ataques perigosos), H2H e escalações se visíveis." },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        temperature: 0.1,
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      return { text: "", note: `vision_http_${resp.status}: ${errText.slice(0, 180)}` };
    }
    const json = await resp.json();
    const text: string = json?.choices?.[0]?.message?.content ?? "";
    return { text: text.trim(), note: text ? "vision_ok" : "vision_empty" };
  } catch (err) {
    return { text: "", note: `vision_error: ${(err as Error).message}` };
  }
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
  const ocrLow = typeof body.ocrConfidence === "number" && body.ocrConfidence < OCR_TEXT_CONFIDENCE_FLOOR;

  // Nível 1+2: parser sobre texto (cliente já enviou OCR concatenado, se houve)
  let parsed = parseSuperbetPayload({
    text: body.text ?? null,
    sourceUrl: body.sourceUrl ?? null,
  });

  const extractionLevels: string[] = [];
  if (body.sourceUrl) extractionLevels.push("url");
  if (body.text) extractionLevels.push(ocrLow ? "ocr-low" : "text");

  // Nível 3: Vision quando tem imagem e (sem texto OU OCR fraco OU parser inseguro)
  const needsVision =
    hasImage && (!body.text || ocrLow || parsed.confidence < VISION_CONFIDENCE_FLOOR);

  if (needsVision) {
    const vision = await runVisionFallback(body.imageBase64!);
    if (vision && vision.text) {
      extractionLevels.push("vision");
      // re-parse usando texto bruto + texto vision concatenados
      const merged = [body.text ?? "", vision.text].filter(Boolean).join("\n\n");
      const second = parseSuperbetPayload({
        text: merged,
        sourceUrl: body.sourceUrl ?? null,
      });
      // adota o melhor
      if (second.confidence >= parsed.confidence) {
        parsed = second;
        parsed.note = (parsed.note ? parsed.note + " | " : "") + vision.note;
      }
    } else if (vision) {
      parsed.missingFields.push("vision_failed");
      parsed.note = (parsed.note ? parsed.note + " | " : "") + vision.note;
    }
  }

  if (hasImage && extractionLevels[extractionLevels.length - 1] !== "vision") {
    extractionLevels.push("image-skipped");
  }

  (parsed as any).extractionLevels = extractionLevels;
  if (hasImage && !body.text && parsed.confidence < 0.2) {
    parsed.kind = "image";
  }

  return new Response(JSON.stringify(parsed), {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "X-Parser-Version": PARSER_VERSION,
    },
  });
});
