// Source: ESPN Scoreboard público (site.api.espn.com) — fixtures por data.
// Sem chave, com CORS liberado e cobertura ampla de jogos FUTUROS
// (SportsRC costuma listar poucos jogos além de hoje/amanhã).

import { MatchData } from '@/types/match';

const CACHE_PREFIX = 'espn_fix_';
const CACHE_TTL = 1000 * 60 * 60 * 3; // 3h

const LIVE_STATES = new Set(['in']);

function espnDate(date: string): string {
  return date.replace(/-/g, '');
}

function leagueOf(ev: any): string {
  const note = String(ev?.altGameNote || '').trim();
  if (note) return note.split(',')[0].trim();
  const slug = String(ev?.season?.slug || '').replace(/-/g, ' ').trim();
  return slug || 'Outros';
}

function mapEvent(ev: any): MatchData | null {
  try {
    const comp = ev?.competitions?.[0] || {};
    const list: any[] = Array.isArray(comp.competitors) ? comp.competitors : [];
    const home = list.find((c) => c.homeAway === 'home') || list[0];
    const away = list.find((c) => c.homeAway === 'away') || list[1];
    const homeName = home?.team?.displayName || home?.team?.name || '';
    const awayName = away?.team?.displayName || away?.team?.name || '';
    const iso = ev?.date ? new Date(ev.date).toISOString() : null;
    if (!homeName || !awayName || !iso) return null;

    const state = String(comp?.status?.type?.state || '').toLowerCase();
    const isLive = LIVE_STATES.has(state);
    const completed = Boolean(comp?.status?.type?.completed);

    return {
      id: `espn-${ev.id}`,
      time: iso,
      league: leagueOf(ev),
      homeTeam: homeName,
      awayTeam: awayName,
      homeLogo: home?.team?.logo || undefined,
      awayLogo: away?.team?.logo || undefined,
      isLive,
      status: completed ? 'FT' : isLive ? 'LIVE' : 'NS',
      liveScore: isLive && home?.score != null && away?.score != null
        ? { home: Number(home.score), away: Number(away.score) }
        : undefined,
    } as MatchData;
  } catch { return null; }
}

export async function fetchEspnFixtures(date: string): Promise<MatchData[]> {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + date);
    if (raw) {
      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts < CACHE_TTL && Array.isArray(data) && data.length > 0) return data;
    }
  } catch { /* noop */ }

  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?dates=${espnDate(date)}&limit=500`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    const events: any[] = Array.isArray(json?.events) ? json.events : [];
    const matches = events.map(mapEvent).filter(Boolean) as MatchData[];
    if (matches.length > 0) {
      try {
        localStorage.setItem(CACHE_PREFIX + date, JSON.stringify({ ts: Date.now(), data: matches }));
      } catch { /* noop */ }
    }
    console.info(`[ESPN-Fixtures] date=${date} matches=${matches.length}`);
    return matches;
  } catch (e) {
    console.warn('[ESPN-Fixtures] fetch_exception', e);
    return [];
  }
}
