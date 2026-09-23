// Source: SportsRC v2 (api.sportsrc.org)
// Plano FREE: 1000 req/dia. Cobertura ampla de fixtures, status live,
// odds, stats, lineups, incidents, h2h — via edge proxy `free-football-proxy`.

import { MatchData } from '@/types/match';
import { supabase } from '@/integrations/supabase/client';

const CACHE_PREFIX = 'sportsrc_cache_';
const STALE_PREFIX = 'sportsrc_stale_';
const CACHE_TTL = 1000 * 60 * 60 * 12; // 12h fresh (proxy também cacheia 6h)
const STALE_MAX = 1000 * 60 * 60 * 24 * 7; // 7d último recurso quando upstream falha

const LIVE_STATUSES = new Set(['live', 'inprogress', 'in_progress', '1h', '2h', 'ht', 'halftime']);

function mapMatch(m: any, leagueMeta: any): MatchData | null {
  try {
    const id = String(m?.id ?? '');
    const home = m?.homeTeam || m?.teams?.home?.name || '';
    const away = m?.awayTeam || m?.teams?.away?.name || '';
    if (!id || !home || !away) return null;
    const ts: number | undefined = typeof m?.timestamp === 'number' ? m.timestamp : (typeof m?.fixture?.timestamp === 'number' ? m.fixture.timestamp : undefined);
    const iso = ts ? new Date(ts).toISOString() : new Date().toISOString();
    const status = String(m?.status || '').toLowerCase();
    const isLive = LIVE_STATUSES.has(status);
    const score = m?.score?.current || {};
    return {
      id: `srcv2-${id}`,
      providerFixtureId: id,
      time: iso,
      league: leagueMeta?.name || 'Outros',
      homeTeam: home,
      awayTeam: away,
      homeLogo: m?.teams?.home?.badge || undefined,
      awayLogo: m?.teams?.away?.badge || undefined,
      isLive,
      kickoff: m?.kickoff || m?.fixture?.date || iso,
      fixture: m?.fixture || undefined,
      status: m?.status_detail || m?.status || m?.fixture?.status?.short || undefined,
      liveScore: isLive && typeof score.home === 'number' && typeof score.away === 'number'
        ? { home: score.home, away: score.away }
        : undefined,
    } as MatchData;
  } catch { return null; }
}

export async function fetchSportsRC(date: string): Promise<MatchData[]> {
  try {
    const raw=localStorage.getItem(CACHE_PREFIX+date);
    if(raw){const {ts,data}=JSON.parse(raw);if(Date.now()-ts<CACHE_TTL&&Array.isArray(data)&&data.length>0)return data;}
  }catch{}
  const stale=():MatchData[]=>{try{const raw=localStorage.getItem(STALE_PREFIX+date);if(!raw)return[];const {ts,data}=JSON.parse(raw);if(!Array.isArray(data)||Date.now()-ts>STALE_MAX)return[];return data;}catch{return[];}};
  try{
    const {data,error}=await supabase.functions.invoke('football-api',{body:{date}});
    if(error)throw error;
    const matches=(Array.isArray(data?.matches)?data.matches:[]).map((m:any)=>mapMatch(m,m?.league)).filter(Boolean) as MatchData[];
    if(!matches.length)return stale();
    try{const snap=JSON.stringify({ts:Date.now(),data:matches});localStorage.setItem(CACHE_PREFIX+date,snap);localStorage.setItem(STALE_PREFIX+date,snap);}catch{}
    return matches;
  }catch(e){console.warn('[SportsRC] football-api fetch_exception',e);return stale();}
}
