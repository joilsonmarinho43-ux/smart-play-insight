// =====================================================================
// FONTE DEDICADA — Copa do Mundo (fallback multi-API)
// ---------------------------------------------------------------------
// Quando o SportsRC estoura o limite diário, os jogos da Copa do Mundo
// (e das eliminatórias) somem da Home porque o TSDB `eventsday.php`
// nem sempre traz seleções. Esta fonte busca especificamente as
// competições de seleções em endpoints alternativos gratuitos e
// devolve apenas as partidas da `date` solicitada.
//
// APIs consultadas (todas free, sem chave):
//   1) TheSportsDB — eventsnextleague.php / eventspastleague.php
//      IDs: 4429 (FIFA World Cup), 4481 (WC Qualifiers CONMEBOL),
//           4482 (UEFA), 4483 (CONCACAF), 4484 (AFC), 4485 (CAF),
//           4486 (OFC), 4370 (Friendlies)
//   2) Football-Data.org (via edge proxy) — competição WC (ID 2000)
//      quando FOOTBALL_DATA_ORG_KEY estiver disponível no backend.
// =====================================================================

import { MatchData } from '@/types/match';
import { supabase } from '@/integrations/supabase/client';

const CACHE_PREFIX = 'wc_fallback_';
const CACHE_TTL = 1000 * 60 * 60 * 6; // 6h

// Ligas TheSportsDB relacionadas a seleções (Copa do Mundo + eliminatórias + amistosos)
const TSDB_WC_LEAGUE_IDS: { id: string; name: string }[] = [
  { id: '4429', name: 'FIFA World Cup' },
  { id: '4481', name: 'WC Qualifiers - CONMEBOL' },
  { id: '4482', name: 'WC Qualifiers - UEFA' },
  { id: '4483', name: 'WC Qualifiers - CONCACAF' },
  { id: '4484', name: 'WC Qualifiers - AFC' },
  { id: '4485', name: 'WC Qualifiers - CAF' },
  { id: '4486', name: 'WC Qualifiers - OFC' },
  { id: '4370', name: 'International Friendlies' },
];

function tsdbToMatch(ev: any, leagueName: string): MatchData | null {
  try {
    const id = String(ev.idEvent || '');
    const home = ev.strHomeTeam || '';
    const away = ev.strAwayTeam || '';
    if (!id || !home || !away) return null;
    const iso = ev.strTimestamp
      ? new Date(ev.strTimestamp).toISOString()
      : `${ev.dateEvent || ''}T${ev.strTime || '00:00:00'}Z`;
    return {
      id: `wc-tsdb-${id}`,
      time: iso,
      league: ev.strLeague || leagueName,
      homeTeam: home,
      awayTeam: away,
      homeLogo: ev.strHomeTeamBadge || undefined,
      awayLogo: ev.strAwayTeamBadge || undefined,
      isLive: false,
    } as MatchData;
  } catch { return null; }
}

async function fetchTsdbLeague(leagueId: string, leagueName: string, date: string): Promise<MatchData[]> {
  // ⚠️ TheSportsDB não envia CORS: precisa passar pelo edge proxy.
  const paths = [
    `/eventsnextleague.php`,
    `/eventspastleague.php`,
  ];
  const out: MatchData[] = [];
  for (const path of paths) {
    try {
      const { data, error } = await supabase.functions.invoke('free-football-proxy', {
        body: { provider: 'thesportsdb', path, params: { id: leagueId } },
      });
      if (error || !data?.ok) continue;
      const events: any[] = Array.isArray(data?.data?.events) ? data.data.events : [];
      for (const ev of events) {
        if (ev?.dateEvent !== date) continue;
        const m = tsdbToMatch(ev, leagueName);
        if (m) out.push(m);
      }
    } catch { /* noop */ }
  }
  return out;
}

async function fetchFootballDataWC(date: string): Promise<MatchData[]> {
  try {
    // Competition 2000 = FIFA World Cup (Football-Data.org)
    const { data, error } = await supabase.functions.invoke('free-football-proxy', {
      body: {
        provider: 'football-data-org',
        path: '/v4/competitions/2000/matches',
        params: { dateFrom: date, dateTo: date },
      },
    });
    if (error || !data?.ok) return [];
    const matches: any[] = Array.isArray(data?.data?.matches) ? data.data.matches : [];
    return matches.map((m: any) => {
      const id = String(m?.id ?? '');
      const home = m?.homeTeam?.name || '';
      const away = m?.awayTeam?.name || '';
      if (!id || !home || !away) return null;
      return {
        id: `wc-fdo-${id}`,
        time: m?.utcDate || new Date().toISOString(),
        league: m?.competition?.name || 'FIFA World Cup',
        homeTeam: home,
        awayTeam: away,
        homeLogo: m?.homeTeam?.crest || undefined,
        awayLogo: m?.awayTeam?.crest || undefined,
        isLive: ['IN_PLAY', 'PAUSED', 'LIVE'].includes(String(m?.status || '').toUpperCase()),
      } as MatchData;
    }).filter(Boolean) as MatchData[];
  } catch {
    return [];
  }
}

export async function fetchWorldCupFallback(date: string): Promise<MatchData[]> {
  // cache local para não repetir chamadas na navegação entre abas
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + date);
    if (raw) {
      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts < CACHE_TTL && Array.isArray(data)) return data;
    }
  } catch { /* noop */ }

  const results = await Promise.allSettled([
    ...TSDB_WC_LEAGUE_IDS.map(l => fetchTsdbLeague(l.id, l.name, date)),
    fetchFootballDataWC(date),
  ]);

  const all: MatchData[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) all.push(...r.value);
  }

  // dedupe interno por times+data
  const seen = new Set<string>();
  const merged: MatchData[] = [];
  for (const m of all) {
    const key = `${(m.homeTeam || '').toLowerCase()}|${(m.awayTeam || '').toLowerCase()}|${(m.time || '').slice(0, 10)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(m);
  }

  try {
    localStorage.setItem(CACHE_PREFIX + date, JSON.stringify({ ts: Date.now(), data: merged }));
  } catch { /* noop */ }

  console.info(`[WC-Fallback] date=${date} matches=${merged.length}`);
  return merged;
}
