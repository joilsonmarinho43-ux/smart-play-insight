import { corsHeaders } from '../_shared/cors.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const CACHE_TTL_MS = 30 * 60 * 1000;
type Candidate = {
  id: string;
  providerFixtureId?: string;
  time: string;
  kickoff: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  homeLogo?: string;
  awayLogo?: string;
  isLive: boolean;
  status: string;
  __source: string;
  aiEvidence: {
    sourceName: string;
    sourceUrl: string;
    observedAt: string;
    observed: true;
    estimated: false;
  };
};

const SYSTEM = `Você é o mecanismo de descoberta de jogos do NEXUS 33.
OBJETIVO: encontrar partidas REAIS de futebol para a data exata solicitada, usando pesquisa web do Google.

REGRAS:
1. Pesquise a data EXATA informada. Não substitua por outra data.
2. Só retorne partidas que você conseguiu confirmar em uma fonte web identificável.
3. Não invente jogos, horários, competições, IDs ou escudos.
4. O horário deve ser ISO-8601. Se a fonte só informar hora local, converta com cuidado; se o fuso não puder ser confirmado, use o horário publicado e marque a fonte, mas NÃO invente precisão.
5. Não use conhecimento interno como confirmação. A confirmação precisa vir da pesquisa web.
6. Priorize fontes oficiais de competição/clubes e calendários reconhecidos.
7. Não retorne resultados já encerrados como próximos. Para a Home, priorize jogos agendados e jogos em andamento.
8. Retorne os campos estruturados pedidos abaixo. A fonte precisa ser uma URL web real consultada.
FORMATO DE CADA ITEM:
homeTeam, awayTeam, league, kickoff ISO-8601, status scheduled|live, sourceName, sourceUrl`;

function normalize(raw:any, requestedDate:string, grounded:Set<string>): Candidate[] {
  const items = Array.isArray(raw?.matches) ? raw.matches : [];
  const now = new Date().toISOString();
  return items.slice(0, 30).flatMap((x:any, i:number) => {
    const home=String(x?.homeTeam||'').trim();
    const away=String(x?.awayTeam||'').trim();
    const league=String(x?.league||'').trim();
    const kickoff=String(x?.kickoff||'').trim();
    const sourceName=String(x?.sourceName||'').trim();
    const sourceUrl=String(x?.sourceUrl||'').trim();
    let verifiedUrl: string;
    try { verifiedUrl = new URL(sourceUrl).href; } catch { return []; }
    if(!home||!away||!league||!kickoff||!sourceName||!grounded.has(verifiedUrl)) return [];
    const ms=Date.parse(kickoff);
    if(Number.isNaN(ms)) return [];
    const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Belem',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms));
    if(date!==requestedDate) return [];
    const status=String(x?.status||'scheduled').toLowerCase()==='live'?'live':'scheduled';
    const safeHome=home.replace(/[<>]/g,'').slice(0,100), safeAway=away.replace(/[<>]/g,'').slice(0,100);
    return [{
      id:`ai-${requestedDate}-${i}-${safeHome}-${safeAway}`.toLowerCase().replace(/[^a-z0-9]+/g,'-'),
      providerFixtureId: undefined,
      time:new Date(ms).toISOString(),
      kickoff:new Date(ms).toISOString(),
      league:league.replace(/[<>]/g,'').slice(0,120),
      homeTeam:safeHome,
      awayTeam:safeAway,
      isLive:status==='live',
      status,
      __source:'ai-web-research',
      aiEvidence:{sourceName:sourceName.slice(0,120),sourceUrl:verifiedUrl,observedAt:now,observed:true,estimated:false},
    } as Candidate];
  });
}

async function cacheGet(key:string) {
  try {
    const url=Deno.env.get('SUPABASE_URL'), service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if(!url||!service)return null;
    const r=await fetch(`${url}/rest/v1/cache_api?select=dados_json,ultima_atualizacao&cache_key=eq.${encodeURIComponent(key)}&limit=1`,{headers:{apikey:service,Authorization:`Bearer ${service}`}});
    if(!r.ok)return null;
    const rows=await r.json(); const row=rows?.[0];
    if(!row||Date.now()-new Date(row.ultima_atualizacao).getTime()>CACHE_TTL_MS)return null;
    return row.dados_json;
  } catch{return null;}
}
async function cacheSet(key:string,value:any){
  try {
    const url=Deno.env.get('SUPABASE_URL'), service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if(!url||!service)return;
    await fetch(`${url}/rest/v1/cache_api`,{method:'POST',headers:{apikey:service,Authorization:`Bearer ${service}`,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates'},body:JSON.stringify({cache_key:key,dados_json:value,status_jogo:'AI_FIXTURES',ultima_atualizacao:new Date().toISOString()})});
  } catch{}
}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response(null,{headers:corsHeaders});
  try {
    const token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'').trim()||'';
    const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
    const url=Deno.env.get('SUPABASE_URL')||'';
    if(!token)return new Response(JSON.stringify({ok:false,error:'AUTH_REQUIRED'}),{status:401,headers:{...corsHeaders,'Content-Type':'application/json'}});
    const sb=createClient(url,service);
    const {data:{user},error}=await sb.auth.getUser(token);
    if(error||!user)return new Response(JSON.stringify({ok:false,error:'AUTH_REQUIRED'}),{status:401,headers:{...corsHeaders,'Content-Type':'application/json'}});
    // Authenticated fallback. Do not depend on the operational check_rate_limit RPC here:
    // that RPC is service-only and its SQL argument names vary across deployments.
    // Gemini quota plus the 30-minute server cache bounds upstream usage.
    const body=await req.json().catch(()=>({}));
    const date=typeof body?.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(body.date)?body.date:'';
    if(!date)return new Response(JSON.stringify({ok:false,error:'DATE_REQUIRED',matches:[]}),{status:200,headers:{...corsHeaders,'Content-Type':'application/json'}});
    const key=`ai-fixtures:v2:${date}`;
    const cached=await cacheGet(key);
    if(cached)return new Response(JSON.stringify({...cached,cached:true}),{headers:{...corsHeaders,'Content-Type':'application/json'}});
    const gemini=Deno.env.get('GEMINI_API_KEY')||'';
    if(!gemini)return new Response(JSON.stringify({ok:true,matches:[],status:'AI_UNAVAILABLE',reason:'GEMINI_API_KEY_MISSING'}),{headers:{...corsHeaders,'Content-Type':'application/json'}});
    const query=`Encontre jogos de futebol REAIS e confirmados para ${date} (fuso America/Belem/Brasil). Pesquise na web agora. Liste até 20 partidas, cobrindo competições relevantes. Para cada jogo informe mandante, visitante, competição, horário de início, status e a fonte que confirma o jogo. Não inclua partidas de outra data.`;
    let data:any=null, provider='', upstreamStatus=0;
    for(const model of ['gemini-2.5-flash-lite','gemini-2.5-flash']) {
      try {
        const controller=new AbortController();
        const timer=setTimeout(()=>controller.abort(),45000);
        let resp:Response;
        try {
          resp=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${gemini}`,{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({system_instruction:{parts:[{text:SYSTEM}]},contents:[{role:'user',parts:[{text:query}]}],generationConfig:{temperature:0.05},tools:[{google_search:{}}]})});
        } finally {clearTimeout(timer);}
        if(!resp.ok){upstreamStatus=resp.status;continue;}
        data=await resp.json();provider=model;break;
      } catch {upstreamStatus=504;}
    }
    if(!data)return new Response(JSON.stringify({ok:true,matches:[],status:'AI_RESEARCH_FAILED',upstreamStatus}),{headers:{...corsHeaders,'Content-Type':'application/json'}});
    const grounded=new Set<string>((data?.candidates?.[0]?.groundingMetadata?.groundingChunks||[]).flatMap((x:any)=>{try{return [new URL(x?.web?.uri).href];}catch{return [];}}));
    const parts=data?.candidates?.[0]?.content?.parts||[];
    const rawText=parts.map((p:any)=>p?.text||'').join('');
    let parsed:any=null;
    try{parsed=JSON.parse(rawText.replace(/^\`\`\`(?:json)?/i,'').replace(/\`\`\`$/,'').trim());}catch{}
    // Search-grounded Gemini can wrap JSON in explanatory text. Recover the
    // first JSON object without weakening evidence validation below.
    if(!parsed){
      const start=rawText.indexOf('{'), end=rawText.lastIndexOf('}');
      if(start>=0&&end>start){try{parsed=JSON.parse(rawText.slice(start,end+1));}catch{}}
    }
    const matches=normalize(parsed,date,grounded);
    const result={ok:true,status:matches.length?'AI_FIXTURES_OK':'NO_CONFIRMED_FIXTURES',matches,provider:`${provider}-google-search`,generatedAt:new Date().toISOString()};
    await cacheSet(key,result);
    return new Response(JSON.stringify(result),{headers:{...corsHeaders,'Content-Type':'application/json'}});
  } catch(e) {
    return new Response(JSON.stringify({ok:true,matches:[],status:'AI_FIXTURES_ERROR',reason:e instanceof Error?e.message:'internal_error'}),{headers:{...corsHeaders,'Content-Type':'application/json'}});
  }
});
