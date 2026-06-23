// Superbet Connect — Parser endpoint (Fase 4)
// Pipeline resiliente em camadas:
//  Nível 1: URL estruturada (parseSuperbetUrl)
//  Nível 2: Regex/heurística sobre texto bruto + OCR Tesseract (cliente)
//  Nível 3: Gemini Vision fallback para screenshots
//  Nível 4: SportsRC v2 para complementar match/score/league/status
//
// Cada captura registra a saúde em `superbet_parser_health`:
//  - missing_fields: lista de campos ainda ausentes ao final
//  - fallbacks_used: ordem das camadas acionadas
//  - vision_used / sportsrc_used / sportsrc_matched

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { parseSuperbetPayload, PARSER_VERSION } from "../_shared/superbetParser.ts";
import { enrichFromSportsRC } from "../_shared/superbetSportsrc.ts";

interface Body {
  captureId?: string;
  text?: string | null;
  sourceUrl?: string | null;
  imageBase64?: string | null;
  marketHint?: string | null;
  ocrConfidence?: number | null;
}

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const VISION_MODEL = "google/gemini-2.5-flash";
const VISION_CONFIDENCE_FLOOR = 0.4;
const OCR_TEXT_CONFIDENCE_FLOOR = 55;
const SPORTSRC_TRIGGER_CONFIDENCE = 0.65;

async function runVisionFallback(imageBase64: string): Promise<{ text: string; note: string } | null> {
  if (!LOVABLE_API_KEY) return null;
  try {
    const dataUrl = imageBase64.startsWith("data:") ? imageBase64 : `data:image/png;base64,${imageBase64}`;
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
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

async function recordHealth(row: {
  capture_id?: string | null;
  parser_version: string;
  kind?: string | null;
  confidence?: number | null;
  missing_fields: string[];
  fallbacks_used: string[];
  vision_used: boolean;
  sportsrc_used: boolean;
  sportsrc_matched: boolean;
  notes?: string | null;
  payload?: unknown;
}) {
  if (!SUPABASE_URL || !SERVICE_ROLE) return;
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    await admin.from("superbet_parser_health").insert(row);
  } catch (e) {
    console.warn("[parser-health] insert failed", (e as Error).message);
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
  const extractionLevels: string[] = [];
  const notes: string[] = [];

  // Nível 1 + 2
  let parsed = parseSuperbetPayload({
    text: body.text ?? null,
    sourceUrl: body.sourceUrl ?? null,
  });
  if (body.sourceUrl) extractionLevels.push("url");
  if (body.text) extractionLevels.push(ocrLow ? "ocr-low" : "text");

  // Nível 3 — Vision
  let visionUsed = false;
  const needsVision = hasImage && (!body.text || ocrLow || parsed.confidence < VISION_CONFIDENCE_FLOOR);
  if (needsVision) {
    const vision = await runVisionFallback(body.imageBase64!);
    if (vision) {
      visionUsed = true;
      notes.push(vision.note);
      if (vision.text) {
        extractionLevels.push("vision");
        const merged = [body.text ?? "", vision.text].filter(Boolean).join("\n\n");
        const second = parseSuperbetPayload({ text: merged, sourceUrl: body.sourceUrl ?? null });
        if (second.confidence >= parsed.confidence) parsed = second;
      } else {
        parsed.missingFields.push("vision_failed");
      }
    }
  } else if (hasImage) {
    extractionLevels.push("image-skipped");
  }

  // Nível 4 — SportsRC enrichment
  let sportsrcUsed = false;
  let sportsrcMatched = false;
  const needsSportsrc =
    parsed.confidence < SPORTSRC_TRIGGER_CONFIDENCE ||
    !parsed.match?.score ||
    !parsed.match?.league;
  if (needsSportsrc && parsed.match?.home && parsed.match?.away) {
    sportsrcUsed = true;
    const enr = await enrichFromSportsRC({
      home: parsed.match.home,
      away: parsed.match.away,
    });
    if (enr.note) notes.push(enr.note);
    if (enr.matched && enr.data) {
      sportsrcMatched = true;
      extractionLevels.push("sportsrc");
      parsed.match = {
        home: parsed.match.home ?? enr.data.home,
        away: parsed.match.away ?? enr.data.away,
        league: parsed.match.league ?? enr.data.league,
        score: parsed.match.score ?? enr.data.score,
        minute: parsed.match.minute ?? enr.data.minute,
      };
      (parsed as any).sportsrc = {
        matchId: enr.data.matchId,
        isLive: enr.data.isLive,
        status: enr.data.status,
        fieldsFilled: enr.fieldsFilled,
      };
      // re-pondera confiança levemente quando SportsRC confirma o jogo
      parsed.confidence = Math.min(1, parsed.confidence + 0.1);
      // recalcula missingFields
      parsed.missingFields = parsed.missingFields.filter((f) => {
        if (f === "teams" && parsed.match?.home && parsed.match?.away) return false;
        return true;
      });
    }
  }

  if (hasImage && !body.text && parsed.confidence < 0.2) parsed.kind = "image";
  (parsed as any).extractionLevels = extractionLevels;
  if (notes.length) parsed.note = [parsed.note, ...notes].filter(Boolean).join(" | ");

  // Registra saúde do parser (não bloqueia a resposta)
  await recordHealth({
    capture_id: body.captureId ?? null,
    parser_version: PARSER_VERSION,
    kind: parsed.kind,
    confidence: parsed.confidence,
    missing_fields: parsed.missingFields ?? [],
    fallbacks_used: extractionLevels,
    vision_used: visionUsed,
    sportsrc_used: sportsrcUsed,
    sportsrc_matched: sportsrcMatched,
    notes: parsed.note ?? null,
    payload: {
      hasImage,
      ocrConfidence: body.ocrConfidence ?? null,
      sourceUrlHost: body.sourceUrl ? safeHost(body.sourceUrl) : null,
    },
  });

  return new Response(JSON.stringify(parsed), {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "X-Parser-Version": PARSER_VERSION,
    },
  });
});

function safeHost(u: string): string | null {
  try { return new URL(u).host; } catch { return null; }
}
