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
    if(error||!data?.ok)return [];
    const matches=(Array.isArray(data?.matches)?data.matches:[]).map(normalize).filter(Boolean) as MatchData[];
    if(matches.length)try{localStorage.setItem(CACHE_PREFIX+date,JSON.stringify({ts:Date.now(),data:matches}));}catch{}
    return matches;
  }catch{return []}
}