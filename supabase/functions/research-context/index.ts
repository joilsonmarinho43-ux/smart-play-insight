import { corsHeaders } from '../_shared/cors.ts';

const VERSION = 'v1';
const CACHE_TTL_MS = 20 * 60 * 1000;

type EvidenceType = 'INJURY'|'SUSPENSION'|'LINEUP'|'FORM'|'H2H'|'MOTIVATION'|'REFEREE'|'WEATHER'|'ODDS'|'OTHER';
type SourceType = 'WEB'|'MARKET';

interface Evidence {
  type: EvidenceType;
  sourceType: SourceType;
  sourceName: string;
  sourceUrl: string | null;
  observedAt: string;
  observed: boolean;
  estimated: boolean;
  confidence: number;
  claim: string;
  value: string | number | boolean | null;
}

const SYSTEM = `Você é o Research Evidence Layer do NEXUS 33.
Sua função é pesquisar fatos atuais sobre uma partida e devolver EVIDÊNCIAS verificáveis.

REGRAS OBRIGATÓRIAS:
1. Pesquise somente os campos solicitados.
2. Cada afirmação deve ter fonte identificável e data/hora da pesquisa.
3. Não invente fatos, números, odds, escalações ou probabilidades.
4. Se não encontrar confirmação suficiente, NÃO preencha: retorne evidência vazia para aquele item.
5. Informação publicada por fonte é OBSERVED=true e ESTIMATED=false.
6. Inferência da IA é ESTIMATED=true e não pode ser usada como fato observado.
7. Probabilidade de aposta nunca é uma evidência WEB/MARKET; é produzida pelo modelo NEXUS.
8. Odds só podem ser retornadas como sourceType=MARKET se uma fonte realmente publicar a odd da linha correta. Nunca derive odd de probabilidade.
9. Quando fontes divergirem, registre a divergência como claim e reduza confidence.
10. Responda SOMENTE JSON válido.

FORMATO:
{"evidence":[{"type":"INJURY|SUSPENSION|LINEUP|FORM|H2H|MOTIVATION|REFEREE|WEATHER|ODDS|OTHER","sourceType":"WEB|MARKET","sourceName":"...","sourceUrl":"...","observedAt":"ISO-8601","observed":true,"estimated":false,"confidence":0,"claim":"...","value":null}]}`;

function normalize(raw: any): Evidence[] {
  const items = Array.isArray(raw?.evidence) ? raw.evidence : [];
  return items.slice(0, 30).flatMap((x: any) => {
    const type = ['INJURY','SUSPENSION','LINEUP','FORM','H2H','MOTIVATION','REFEREE','WEATHER','ODDS','OTHER'].includes(x?.type) ? x.type : 'OTHER';
    const sourceType: SourceType = x?.sourceType === 'MARKET' ? 'MARKET' : 'WEB';
    const observed = x?.observed === true && x?.estimated !== true && typeof x?.sourceName === 'string' && x.sourceName.trim().length > 0;
    const confidence = Math.max(0, Math.min(100, Number.isFinite(Number(x?.confidence)) ? Number(x.confidence) : 0));
    const observedAt = typeof x?.observedAt === 'string' && !Number.isNaN(Date.parse(x.observedAt)) ? new Date(x.observedAt).toISOString() : new Date().toISOString();
    const claim = typeof x?.claim === 'string' ? x.claim.trim() : '';
    if (!claim) return [];
    return [{
      type,
      sourceType,
      sourceName: String(x.sourceName || 'unknown').trim(),
      sourceUrl: typeof x?.sourceUrl === 'string' ? x.sourceUrl : null,
      observedAt,
      observed,
      estimated: x?.estimated === true,
      confidence: Math.round(confidence),
      claim,
      value: x?.value ?? null,
    }];
  });
}

function cacheKey(matchId: string, fields: string[]) {
  return `research:${VERSION}:${matchId}:${fields.sort().join(',')}`;
}

async function cacheGet(key: string) {
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !service) return null;
    const resp = await fetch(`${url}/rest/v1/cache_api?select=dados_json,ultima_atualizacao&cache_key=eq.${encodeURIComponent(key)}&limit=1`, { headers: { apikey: service, Authorization: `Bearer ${service}` } });
    if (!resp.ok) return null;
    const rows = await resp.json();
    const row = rows?.[0];
    if (!row) return null;
    if (Date.now() - new Date(row.ultima_atualizacao).getTime() > CACHE_TTL_MS) return null;
    return row.dados_json;
  } catch { return null; }
}

async function cacheSet(key: string, value: unknown) {
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !service) return;
    await fetch(`${url}/rest/v1/cache_api`, { method: 'POST', headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ cache_key: key, dados_json: value, status_jogo: 'RESEARCH', ultima_atualizacao: new Date().toISOString() }) });
  } catch { /* cache failure must never block research */ }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const matchId = String(body?.match?.id ?? body?.fixtureId ?? '').trim();
    const home = String(body?.match?.homeTeam ?? body?.homeName ?? '').trim();
    const away = String(body?.match?.awayTeam ?? body?.awayName ?? '').trim();
    const league = String(body?.match?.league ?? '').trim();
    const kickoff = body?.match?.kickoff ?? body?.kickoffISO ?? null;
    const requestedFields = Array.isArray(body?.fields) ? body.fields.filter((x: any) => typeof x === 'string').slice(0, 10) : ['INJURY','SUSPENSION','LINEUP','FORM','MOTIVATION','REFEREE','WEATHER'];
    if (!matchId || !home || !away) return new Response(JSON.stringify({ ok:false, error:'match_required', evidence:[] }), { status:200, headers:{...corsHeaders,'Content-Type':'application/json'} });

    const key = cacheKey(matchId, requestedFields);
    const cached = await cacheGet(key);
    if (cached) return new Response(JSON.stringify({ ...cached, cached:true }), { headers:{...corsHeaders,'Content-Type':'application/json'} });

    const gemini = Deno.env.get('GEMINI_API_KEY');
    if (!gemini) return new Response(JSON.stringify({ ok:true, evidence:[], status:'RESEARCH_UNAVAILABLE', reason:'GEMINI_API_KEY_MISSING' }), { headers:{...corsHeaders,'Content-Type':'application/json'} });

    const query = `Partida: ${home} x ${away}. Competição: ${league || 'não informada'}. Início: ${kickoff || 'não informado'}. Pesquise somente: ${requestedFields.join(', ')}. Priorize informações atuais, confirme a partida e use fontes identificáveis. Não pesquise nem invente probabilidades do modelo.`;
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${gemini}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ system_instruction:{parts:[{text:SYSTEM}]}, contents:[{role:'user',parts:[{text:query}]}], generationConfig:{temperature:0.1,responseMimeType:'application/json'}, tools:[{google_search:{}}]}) });
    if (!resp.ok) return new Response(JSON.stringify({ ok:true, evidence:[], status:'RESEARCH_FAILED', upstreamStatus:resp.status }), { headers:{...corsHeaders,'Content-Type':'application/json'} });
    const data = await resp.json();
    const text = (data?.candidates?.[0]?.content?.parts ?? []).map((p:any) => p?.text ?? '').join('');
    let parsed:any = null;
    try { parsed = JSON.parse(text.replace(/^```json/i,'').replace(/```$/i,'').trim()); } catch { parsed = null; }
    const evidence = normalize(parsed);
    const result = { ok:true, status:evidence.length ? 'RESEARCH_OK' : 'NO_CONFIRMED_EVIDENCE', match:{id:matchId,home,away,league,kickoff}, evidence, generatedAt:new Date().toISOString(), provider:'gemini-2.5-pro-google-search' };
    await cacheSet(key, result);
    return new Response(JSON.stringify(result), { headers:{...corsHeaders,'Content-Type':'application/json'} });
  } catch (error) {
    return new Response(JSON.stringify({ ok:true, evidence:[], status:'RESEARCH_ERROR', reason:error instanceof Error ? error.message : 'internal_error' }), { status:200, headers:{...corsHeaders,'Content-Type':'application/json'} });
  }
});
