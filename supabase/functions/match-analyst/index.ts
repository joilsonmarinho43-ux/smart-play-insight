import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders } from '../_shared/cors.ts';

const VERSION = 'v13';
const CACHE_TTL_MS = 30 * 60 * 1000;
async function payloadHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

const sb = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

async function requireAuthenticatedCaller(req: Request): Promise<Response | null> {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const authorization = req.headers.get('authorization')?.replace(/^Bearer\\s+/i, '').trim() || '';
  const apiKey = req.headers.get('apikey')?.trim() || '';
  if (serviceKey && (authorization === serviceKey || apiKey === serviceKey)) return null;

  if (!authorization) {
    return new Response(JSON.stringify({ error: 'AUTH_REQUIRED' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: { user }, error } = await sb().auth.getUser(authorization);
  if (error || !user) {
    return new Response(JSON.stringify({ error: 'AUTH_REQUIRED' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  return null;
}

async function cacheGet(key:string){try{const {data}=await sb().from('cache_api').select('dados_json,ultima_atualizacao').eq('cache_key',key).maybeSingle();if(!data)return null;if(Date.now()-new Date(data.ultima_atualizacao).getTime()>CACHE_TTL_MS)return null;return data.dados_json;}catch{return null;}}
async function cacheSet(key:string,value:unknown){try{await sb().from('cache_api').upsert({cache_key:key,dados_json:value,status_jogo:'PRE',ultima_atualizacao:new Date().toISOString()});}catch{}}

const SYSTEM=`Você é o auditor pré-jogo do Nexus 33. Revise somente a leitura quantitativa e o contexto recebidos. Você NÃO cria probabilidades, NÃO inventa odds, NÃO escolhe mercado por conta própria e NÃO aumenta confiança.
Regras: dado ausente permanece desconhecido; Big Chances não é xG; odds só são reais quando observadas no payload ou em evidência MARKET com fonte, linha e timestamp; WEB/MARKET não cria probabilidade do modelo; ESTIMATED nunca vira OBSERVED; a IA pode manter, reduzir qualitativamente ou BLOQUEAR, nunca promover um sinal; não use linguagem de certeza; responda SOMENTE JSON válido.
Formato: {"cenario":"...","pontoAtencao":"...","veredito":"Sinal analítico|Aguardar atualização|Sem evidência suficiente","risco":"baixo|medio|alto","aiAudit":{"status":"PASS|CAUTION|BLOCK","reasons":["..."],"evidenceQuality":"alta|media|baixa","source":"payload|research|mixed"},"contextoDetalhado":{"desfalques":"...","arbitro":"...","clima":"...","motivacao":"..."},"mercados":{"vitoria":"...","duplaChance":"...","handicap":"...","overUnderGols":"...","btts":"...","escanteios":"...","cartoes":"...","placarExato":"..."},"oddsReferencia":{"casa":null,"empate":null,"fora":null,"over25":null,"under25":null,"bttsSim":null,"escanteiosOver9":null,"cartoesOver4":null}}`;
const RESEARCH=SYSTEM+`\nMODO PESQUISA: use as evidências estruturadas já fornecidas. Só use pesquisa Google para esclarecer lacunas/divergências explícitas e nunca invente confirmação.`;

function makePayload(body:any){const m=body?.match??{},r=body?.reading??{},c=body?.context??{},fb=body?.fallbackStats??null,e=Array.isArray(body?.researchEvidence)?body.researchEvidence:[];return JSON.stringify({partida:{id:m.id??body?.fixtureId??null,casa:m.homeTeam??null,fora:m.awayTeam??null,liga:m.league??null,horario:m.time??null,status:m.status??null,minuto:m.minute??null},probabilidades_modelo:m.matchProbabilities??null,leitura_tecnica:{projetados:r.projectedGoals??null,placares:r.likelyScores??null,tendencias:r.trendTags??null,oportunidades:r.opportunities??null,linhas_gols:r.goalLines??null},contexto:{confiabilidade:c.reliability??null,escalacoes:c.lineups??null,lesoes:c.injuries??null,motivacao:c.motivation??null,desgaste:c.fatigue??null},evidencias_pesquisa:e.slice(0,40),mercado_observado:c.odds??null,fallback_stats:fb?{fonte:fb.source??null,confianca:fb.confidence_score??null,baixa_confianca:fb.lowConfidence??null,campo_ausentes:fb.missing??[],dados:fb.stats??{}}:null});}
function parse(raw:string){try{const s=raw.trim().replace(/^```json/i,'').replace(/```$/i,'').trim();const o=JSON.parse(s);return o&&typeof o==='object'?o:null;}catch{return null;}}
function safe(reason:string){return{cenario:'Não há dados suficientes para uma leitura responsável.',pontoAtencao:`Análise incompleta: ${reason}.`,veredito:'Sem evidência suficiente',risco:'alto',aiAudit:{status:'CAUTION',reasons:[reason],evidenceQuality:'baixa',source:'payload'},contextoDetalhado:{desfalques:'não confirmado',arbitro:'não confirmado',clima:'não confirmado',motivacao:'não confirmado'},mercados:{vitoria:'dados insuficientes',duplaChance:'dados insuficientes',handicap:'dados insuficientes',overUnderGols:'dados insuficientes',btts:'dados insuficientes',escanteios:'dados insuficientes',cartoes:'dados insuficientes',placarExato:'dados insuficientes'},oddsReferencia:{casa:null,empate:null,fora:null,over25:null,under25:null,bttsSim:null,escanteiosOver9:null,cartoesOver4:null},_source:'safe_fallback'};}
function normalize(o:any,research:boolean){const text=(v:any,f='não confirmado')=>typeof v==='string'&&v.trim()?v.trim():f;const odd=(v:any)=>{const n=Number(v);return Number.isFinite(n)&&n>1?n:null};const a=o?.aiAudit??{};return{cenario:text(o?.cenario),pontoAtencao:text(o?.pontoAtencao),veredito:text(o?.veredito),risco:['baixo','medio','alto'].includes(o?.risco)?o.risco:'alto',aiAudit:{status:['PASS','CAUTION','BLOCK'].includes(a.status)?a.status:'CAUTION',reasons:Array.isArray(a.reasons)?a.reasons.filter((x:any)=>typeof x==='string').slice(0,6):['auditoria_incompleta'],evidenceQuality:['alta','media','baixa'].includes(a.evidenceQuality)?a.evidenceQuality:'baixa',source:research?'research':(['payload','mixed'].includes(a.source)?a.source:'payload')},contextoDetalhado:{desfalques:text(o?.contextoDetalhado?.desfalques),arbitro:text(o?.contextoDetalhado?.arbitro),clima:text(o?.contextoDetalhado?.clima),motivacao:text(o?.contextoDetalhado?.motivacao)},mercados:{vitoria:text(o?.mercados?.vitoria,'dados insuficientes'),duplaChance:text(o?.mercados?.duplaChance,'dados insuficientes'),handicap:text(o?.mercados?.handicap,'dados insuficientes'),overUnderGols:text(o?.mercados?.overUnderGols,'dados insuficientes'),btts:text(o?.mercados?.btts,'dados insuficientes'),escanteios:text(o?.mercados?.escanteios,'dados insuficientes'),cartoes:text(o?.mercados?.cartoes,'dados insuficientes'),placarExato:text(o?.mercados?.placarExato,'dados insuficientes')},oddsReferencia:{casa:odd(o?.oddsReferencia?.casa),empate:odd(o?.oddsReferencia?.empate),fora:odd(o?.oddsReferencia?.fora),over25:odd(o?.oddsReferencia?.over25),under25:odd(o?.oddsReferencia?.under25),bttsSim:odd(o?.oddsReferencia?.bttsSim),escanteiosOver9:odd(o?.oddsReferencia?.escanteiosOver9),cartoesOver4:odd(o?.oddsReferencia?.cartoesOver4)}};}
async function groqAudit(system:string,user:string,key:string){try{const r=await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:'llama-3.3-70b-versatile',messages:[{role:'system',content:system},{role:'user',content:'Audite somente este payload pré-jogo:\n'+user}],response_format:{type:'json_object'},temperature:0.1,max_tokens:2200})});if(!r.ok)return '';const d=await r.json();return d?.choices?.[0]?.message?.content??'';}catch{return ''}}

Deno.serve(async(req)=>{if(req.method==='OPTIONS')return new Response(null,{headers:corsHeaders});const authError=await requireAuthenticatedCaller(req);if(authError)return authError;try{const body=await req.json();const research=body?.pesquisaWeb===true;const id=body?.match?.id??body?.fixtureId??'unknown';const user=makePayload(body);const fingerprint=await payloadHash(user);const key=`analyst:${VERSION}:${research?'research':'standard'}:${id}:${fingerprint}`;const cached=await cacheGet(key);if(cached)return new Response(JSON.stringify({...cached,cached:true}),{headers:{...corsHeaders,'Content-Type':'application/json'}});const system=research?RESEARCH:SYSTEM;const gemini=Deno.env.get('GEMINI_API_KEY');const groq=Deno.env.get('GROQ_API_KEY');let content='';let source='';
if(research&&gemini){try{const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${gemini}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({system_instruction:{parts:[{text:system}]},contents:[{role:'user',parts:[{text:'Audite somente este payload pré-jogo:\n'+user}]}],generationConfig:{temperature:0.1},tools:[{google_search:{}}]})});if(r.ok){const d=await r.json();content=(d?.candidates?.[0]?.content?.parts??[]).map((p:any)=>p?.text??'').join('');if(content)source='gemini-2.5-pro';}}catch{}}
if(!content&&groq){content=await groqAudit(system,user,groq);if(content)source='groq-llama-3.3-70b';}
if(!content&&!research&&gemini){try{const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${gemini}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({system_instruction:{parts:[{text:system}]},contents:[{role:'user',parts:[{text:user}]}],generationConfig:{temperature:0.1,responseMimeType:'application/json'}})});if(r.ok){const d=await r.json();content=(d?.candidates?.[0]?.content?.parts??[]).map((p:any)=>p?.text??'').join('');if(content)source='gemini-2.5-flash';}}catch{}}
const parsed=parse(content);const result=parsed?normalize(parsed,research):safe(content?'invalid_ai_response':'provider_unavailable');(result as any)._source=source||result._source;await cacheSet(key,result);return new Response(JSON.stringify(result),{headers:{...corsHeaders,'Content-Type':'application/json'}});}catch(e){return new Response(JSON.stringify(safe(e instanceof Error?e.message:'internal_error')),{status:200,headers:{...corsHeaders,'Content-Type':'application/json'}});}});
