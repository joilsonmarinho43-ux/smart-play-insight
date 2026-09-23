import { MatchData } from '@/types/match';
import { supabase } from '@/integrations/supabase/client';

const CACHE_PREFIX='ai_fixture_cache_';
const CACHE_TTL=1000*60*30;

function normalize(m:any):MatchData|null{
  const home=String(m?.homeTeam||'').trim(), away=String(m?.awayTeam||'').trim();
  const kickoff=String(m?.kickoff||m?.time||'').trim();
  if(!home||!away||!kickoff)return null;
  const ms=Date.parse(kickoff); if(Number.isNaN(ms))return null;
  return {
    id:String(m?.id||`ai-${home}-${away}-${kickoff}`),
    providerFixtureId:m?.providerFixtureId,
    time:new Date(ms).toISOString(),
    kickoff:new Date(ms).toISOString(),
    league:String(m?.league||'Outros'),
    homeTeam:home,
    awayTeam:away,
    homeLogo:m?.homeLogo,
    awayLogo:m?.awayLogo,
    isLive:m?.isLive===true,
    status:m?.status||'scheduled',
    fixture:{date:new Date(ms).toISOString(),id:m?.providerFixtureId||m?.id,status:{short:m?.isLive?'LIVE':'NS'}},
    __source:'ai-web-research',
    dataSource:'ai-web-research',
    aiEvidence:m?.aiEvidence,
    dataFreshness:'FRESH',
  } as MatchData;
}

export async function fetchAiFixtures(date:string):Promise<MatchData[]>{
  try{
    const raw=localStorage.getItem(CACHE_PREFIX+date);
    if(raw){const {ts,data}=JSON.parse(raw);if(Date.now()-ts<CACHE_TTL&&Array.isArray(data))return data;}
  }catch{}
  try{
    const {data,error}=await supabase.functions.invoke('ai-fixture-discovery',{body:{date}});
    if(error){
      console.error('[AI-Fixtures] invoke error',error.message||error);
      // supabase-js can collapse a non-2xx Edge response into FunctionsHttpError
      // without exposing the response body. Retry once with the hydrated JWT so
      // the fallback cannot silently disappear from the provider chain.
      const {data:{session}}=await supabase.auth.getSession();
      if(!session?.access_token)return [];
      const base=(import.meta as any).env?.VITE_SUPABASE_URL;
      const anon=(import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY||(import.meta as any).env?.VITE_SUPABASE_ANON_KEY;
      if(!base||!anon)return [];
      const resp=await fetch(`${base}/functions/v1/ai-fixture-discovery`,{method:'POST',headers:{'Content-Type':'application/json',apikey:anon,Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({date})});
      const retry=await resp.json().catch(()=>null);
      console.info('[AI-Fixtures] direct response',JSON.stringify({date,http:resp.status,status:retry?.status,count:Array.isArray(retry?.matches)?retry.matches.length:0,reason:retry?.reason,upstreamStatus:retry?.upstreamStatus}));
      if(!resp.ok||!retry?.ok)return [];
      const matches=(Array.isArray(retry?.matches)?retry.matches:[]).map(normalize).filter(Boolean) as MatchData[];
      if(matches.length)try{localStorage.setItem(CACHE_PREFIX+date,JSON.stringify({ts:Date.now(),data:matches}));}catch{}
      return matches;
    }
    if(!data?.ok){console.error('[AI-Fixtures] rejected',data?.error||data?.status||'unknown');return [];}
    console.info('[AI-Fixtures] response',JSON.stringify({date,status:data?.status,count:Array.isArray(data?.matches)?data.matches.length:0,reason:data?.reason,upstreamStatus:data?.upstreamStatus}));
    const matches=(Array.isArray(data?.matches)?data.matches:[]).map(normalize).filter(Boolean) as MatchData[];
    if(matches.length)try{localStorage.setItem(CACHE_PREFIX+date,JSON.stringify({ts:Date.now(),data:matches}));}catch{}
    return matches;
  }catch(e){console.error('[AI-Fixtures] exception',e);return []}
}