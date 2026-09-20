import { corsHeaders } from '../_shared/cors.ts';

const ESPN = 'https://site.web.api.espn.com';
const TSDB = 'https://www.thesportsdb.com/api/v1/json/123';
const TTL = 6 * 60 * 60 * 1000;
const teamCache = new Map<string, { id:string; slug:string } | null>();
const tsdbTeamCache = new Map<string, string | null>();
const scheduleCache = new Map<string, { ts:number; games:any[] }>();
const tsdbCache = new Map<string, { ts:number; games:any[] }>();

function norm(v:string){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\b(fc|cf|sc|ac|afc|cfc|club|clube)\b/g,' ').replace(/[^a-z0-9]+/g,' ').trim();}
const aliases:Record<string,string>={
  brasil:'Brazil',argelia:'Algeria',inglaterra:'England',jordania:'Jordan',colombia:'Colombia','rd congo':'DR Congo',uzbequistao:'Uzbekistan',gana:'Ghana',panama:'Panama',croacia:'Croatia','arabia saudita':'Saudi Arabia','estados unidos':'United States',eua:'United States',usa:'United States','paises baixos':'Netherlands',holanda:'Netherlands',alemanha:'Germany',franca:'France',espanha:'Spain',italia:'Italy',belgica:'Belgium',suica:'Switzerland',polonia:'Poland',portugal:'Portugal',dinamarca:'Denmark',noruega:'Norway',suecia:'Sweden',turquia:'Turkey',ucrania:'Ukraine',mexico:'Mexico',argentina:'Argentina',uruguai:'Uruguay',paraguai:'Paraguay',chile:'Chile',peru:'Peru',equador:'Ecuador','coreia do sul':'South Korea',japao:'Japan',china:'China',australia:'Australia',egito:'Egypt',marrocos:'Morocco',tunisia:'Tunisia',senegal:'Senegal',nigeria:'Nigeria',camaroes:'Cameroon'
};
function variants(name:string){const n=norm(name);const a=aliases[n];const stripped=String(name).replace(/\s+(FC|CF|SC|AC|AFC|CFC)$/i,'').trim();return [...new Set([name,a,stripped].filter(Boolean))];}
async function get(url:string,headers?:Record<string,string>){try{const c=new AbortController();const t=setTimeout(()=>c.abort(),10000);const r=await fetch(url,{headers,signal:c.signal});clearTimeout(t);if(!r.ok)return null;return await r.json().catch(()=>null);}catch{return null;}}
async function resolveTeam(name:string){
  const key=norm(name);
  if(teamCache.has(key))return teamCache.get(key)!;
  for(const q of variants(name)){
    const j=await get(`${ESPN}/apis/common/v3/search?query=${encodeURIComponent(q)}&limit=20`);
    const items=(j?.items||[]).filter((x:any)=>x?.type==='team' || x?.team?.id);
    if(!items.length)continue;
    const target=norm(q);
    const hit=items.find((x:any)=>norm(x?.displayName||x?.name||x?.team?.displayName||x?.team?.name||'')===target)
      ||items.find((x:any)=>norm(x?.displayName||x?.name||x?.team?.displayName||x?.team?.name||'').includes(target))
      ||items[0];
    const id=hit?.id ?? hit?.team?.id;
    const slug=hit?.defaultLeagueSlug ?? hit?.league?.slug ?? hit?.league?.abbreviation ?? hit?.team?.defaultLeagueSlug;
    if(id&&slug){
      const out={id:String(id),slug:String(slug)};
      teamCache.set(key,out);
      return out;
    }
  }
  teamCache.set(key,null);
  return null;
}
function completed(e:any){return !!e?.competitions?.[0]?.status?.type?.completed;}
function espnNormalize(e:any,teamId:string,slug:string){if(!completed(e))return null;const cs=e?.competitions?.[0]?.competitors||[];if(cs.length<2)return null;const h=cs.find((x:any)=>x?.homeAway==='home')||cs[0];const a=cs.find((x:any)=>x?.homeAway==='away')||cs[1];const hs=Number(h?.score?.value??h?.score),as=Number(a?.score?.value??a?.score);if(!Number.isFinite(hs)||!Number.isFinite(as))return null;const isHome=String(h?.team?.id||h?.id)===String(teamId);return{eventId:String(e?.id||''),leagueSlug:slug,date:String(e?.date||'').slice(0,10),isHome,homeName:String(h?.team?.displayName||h?.team?.name||''),awayName:String(a?.team?.displayName||a?.team?.name||''),hs,as};};}
async function espnGames(team:{id:string;slug:string}){const key=`${team.slug}|${team.id}`;const c=scheduleCache.get(key);if(c&&Date.now()-c.ts<TTL)return c.games;const year=new Date().getUTCFullYear();const queries=['',`?season=${year}&seasontype=1`,`?season=${year-1}&seasontype=1`,`?season=${year-2}&seasontype=1`];const raw:any[]=[];const seen=new Set<string>();for(const q of queries){if(raw.filter(completed).length>=10)break;const j=await get(`${ESPN}/apis/site/v2/sports/soccer/${encodeURIComponent(team.slug)}/teams/${team.id}/schedule${q}`);for(const e of j?.events||[]){const id=String(e?.id||'');if(id&&seen.has(id))continue;if(id)seen.add(id);raw.push(e);}}const games=raw.map(e=>espnNormalize(e,team.id,team.slug)).filter(Boolean);scheduleCache.set(key,{ts:Date.now(),games});return games;}
async function tsdbGames(name:string,teamId?:string){
  const key=norm(name);
  const c=tsdbCache.get(key);
  if(c&&Date.now()-c.ts<TTL)return c.games;
  const out:any[]=[];
  // Prefer the team's event history endpoint; searchevents is only a fallback
  // because it is search-oriented and can omit older fixtures.
  let resolvedId=teamId||null;
  if(!resolvedId){
    const cachedId=tsdbTeamCache.get(key);
    if(cachedId!==undefined) resolvedId=cachedId;
    else {
      for(const q of variants(name)){
        const j=await get(`${TSDB}/searchteams.php?t=${encodeURIComponent(q)}`);
        const teams=Array.isArray(j?.teams)?j.teams:[];
        const target=norm(q);
        const hit=teams.find((x:any)=>norm(x?.strTeam||'')===target)||teams[0];
        if(hit?.idTeam){resolvedId=String(hit.idTeam);break;}
      }
      tsdbTeamCache.set(key,resolvedId);
    }
  }
  if(resolvedId){
    const j=await get(`${TSDB}/eventslast.php?id=${encodeURIComponent(resolvedId)}`);
    for(const e of j?.results||j?.events||[]){
      const hs=Number(e?.intHomeScore),as=Number(e?.intAwayScore);
      if(!Number.isFinite(hs)||!Number.isFinite(as))continue;
      const isHome=String(e?.idHomeTeam)===String(resolvedId);
      out.push({date:String(e?.dateEvent||''),isHome,homeName:String(e?.strHomeTeam||''),awayName:String(e?.strAwayTeam||''),hs,as});
    }
  }
  if(out.length<3){
    for(const q of variants(name)){
      const j=await get(`${TSDB}/searchevents.php?e=${encodeURIComponent(q)}`);
      for(const e of j?.event||[]){
        const hs=Number(e?.intHomeScore),as=Number(e?.intAwayScore);
        if(!Number.isFinite(hs)||!Number.isFinite(as)||!/soccer|football/i.test(e?.strSport||''))continue;
        const isHome=resolvedId?String(e?.idHomeTeam)===String(resolvedId):norm(e?.strHomeTeam||'')===key;
        if(resolvedId && !isHome && String(e?.idAwayTeam)!==String(resolvedId))continue;
        out.push({date:String(e?.dateEvent||''),isHome,homeName:String(e?.strHomeTeam||''),awayName:String(e?.strAwayTeam||''),hs,as});
      }
      if(out.length>=10)break;
    }
  }
  out.sort((a,b)=>b.date.localeCompare(a.date));
  tsdbCache.set(key,{ts:Date.now(),games:out});
  return out;
}
function parseStatValue(value:any){if(value==null)return null;const m=String(value).replace(',','.').match(/-?\d+(?:\.\d+)?/);if(!m)return null;const n=Number(m[0]);return Number.isFinite(n)?n:null;}
function normalizeStatName(v:any){return String(v||'').toLowerCase().replace(/[()%]/g,'').replace(/[^a-z0-9]+/g,' ').trim();}
function extractSummaryStats(raw:any){const out:any={};const teams=Array.isArray(raw?.boxscore?.teams)?raw.boxscore.teams:[];for(const t of teams){const side=t?.homeAway;if(side!=='home'&&side!=='away')continue;const bucket:any={};for(const s of(Array.isArray(t?.statistics)?t.statistics:[])){const key=normalizeStatName(s?.name||s?.displayName),value=parseStatValue(s?.displayValue??s?.value);if(value==null)continue;if(/possession/.test(key))bucket.possession=value;else if(/expected goals|xg/.test(key)&&!/on target/.test(key))bucket.xG=value;else if(/big chances created|chances created/.test(key))bucket.bigChances=value;else if(/^shots$|total shots/.test(key))bucket.totalShots=value;else if(/shots on goal|shots on target/.test(key))bucket.shotsOnGoal=value;else if(/corner/.test(key))bucket.corners=value;else if(/offsides/.test(key))bucket.offsides=value;else if(/fouls committed|fouls/.test(key))bucket.fouls=value;else if(/yellow cards|yellow/.test(key))bucket.yellowCards=value;}out[side]=bucket;}return out;}
const summaryCache=new Map<string,{ts:number;stats:any}>();
async function fetchSummaryStats(games:any[]){const selected=games.filter(g=>g?.eventId&&g?.leagueSlug).slice(0,5);return await Promise.all(selected.map(async g=>{const key=`${g.leagueSlug}|${g.eventId}`;const cached=summaryCache.get(key);if(cached&&Date.now()-cached.ts<TTL)return{g,stats:cached.stats};const raw=await get(`${ESPN}/apis/site/v2/sports/soccer/${encodeURIComponent(g.leagueSlug)}/summary?event=${encodeURIComponent(g.eventId)}`);const stats=extractSummaryStats(raw);summaryCache.set(key,{ts:Date.now(),stats});return{g,stats};}));}
function avg(values:number[]){return values.length?values.reduce((a,b)=>a+b,0)/values.length:null;}
function summarize(games:any[],summaries:any[]=[]){const seen=new Set<string>();const sorted=games.filter(Boolean).sort((a,b)=>b.date.localeCompare(a.date)).filter(g=>{const k=`${g.date}|${norm(g.isHome?g.awayName:g.homeName)}`;if(seen.has(k))return false;seen.add(k);return true;}).slice(0,5);const gf:number[]=[],ga:number[]=[],recentResults:any[]=[];for(const g of sorted){const my=g.isHome?g.hs:g.as,opp=g.isHome?g.as:g.hs;gf.push(my);ga.push(opp);recentResults.push({result:my>opp?'W':my<opp?'L':'D',gf:my,ga:opp,opp:g.isHome?g.awayName:g.homeName,date:g.date});}const keys=['possession','xG','totalShots','shotsOnGoal','bigChances','corners','offsides','fouls','yellowCards'];const vals:any=Object.fromEntries(keys.map(k=>[k,[]]));const byEvent=new Map(summaries.map((x:any)=>[String(x?.g?.eventId),x?.stats]));for(const g of sorted){const bucket=byEvent.get(String(g.eventId))?.[g.isHome?'home':'away']||{};for(const k of keys)if(Number.isFinite(bucket[k]))vals[k].push(bucket[k]);}const n=gf.length;return{games:n,goalsForAvg:n?gf.reduce((x,y)=>x+y,0)/n:0,goalsAgainstAvg:n?ga.reduce((x,y)=>x+y,0)/n:0,recentGoalsFor:gf,recentGoalsAgainst:ga,recentResults,stats:Object.fromEntries(keys.map(k=>[k,avg(vals[k])])),statsSample:Object.fromEntries(keys.map(k=>[k,vals[k].length]))};}

async function form(name:string){
  const team=await resolveTeam(name);
  const [espn,tsdb]=await Promise.all([
    team?espnGames(team):Promise.resolve([]),
    tsdbGames(name,team?.id),
  ]);
  const games=[...espn,...tsdb];
  const summaries=await fetchSummaryStats(games);const result=summarize(games,summaries);
  return result;
}

Deno.serve(async(req)=>{if(req.method==='OPTIONS')return new Response(null,{headers:corsHeaders});try{const body=await req.json();const home=String(body?.home||'').trim(),away=String(body?.away||'').trim();if(!home||!away)return new Response(JSON.stringify({ok:false,error:'home_and_away_required'}),{status:400,headers:{...corsHeaders,'Content-Type':'application/json'}});const [h,a]=await Promise.all([form(home),form(away)]);return new Response(JSON.stringify({ok:true,home:h,away:a,source:'ESPN public API + TheSportsDB free',generatedAt:new Date().toISOString()}),{headers:{...corsHeaders,'Content-Type':'application/json'}});}catch(e){return new Response(JSON.stringify({ok:false,error:e instanceof Error?e.message:'internal_error'}),{status:200,headers:{...corsHeaders,'Content-Type':'application/json'}});}});
