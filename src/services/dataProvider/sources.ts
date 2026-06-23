// Registro de fontes de dados. Importado uma vez no bootstrap.
// Ordem real hoje:
//   1) football-api-edge  (API-Sports via Edge Function — fonte rica)
//   2) thesportsdb-public (fonte pública independente — fallback real)
//  99) stale-local-cache  (último recurso)

import { MatchData } from '@/types/match';
import { registerSource } from './index';
import { fetchMatches } from '../footballApi';
import { fetchFootballDataOrg } from './sources/footballDataOrg';

// =====================================================================
// FONTE 1 (PRIMÁRIA): Football-Data.org (free, ligas principais)
// Via edge proxy `free-football-proxy`. Excelente cobertura de fixtures
// das principais ligas europeias + CL. Sem stats avançadas live.
// =====================================================================
registerSource({
  name: 'football-data-org',
  priority: 1,
  fetchByDate: async (date: string): Promise<MatchData[]> => {
    return await fetchFootballDataOrg(date);
  },
});

// =====================================================================
// FONTE 2 (LEGADA / DORMENTE): Edge Function football-api (API-Sports)
// Mantida como fallback caso a conta API-Sports volte. Rebaixada de
// prioridade — entra apenas se a free não cobriu a partida.
// =====================================================================
registerSource({
  name: 'football-api-edge',
  priority: 5,
  fetchByDate: async (date: string): Promise<MatchData[]> => {
    return await fetchMatches(date);
  },
});

// =====================================================================
// FONTE 2 (SECUNDÁRIA — ATIVA): TheSportsDB (público, sem chave obrigatória)
// Endpoint free: https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d=YYYY-MM-DD&s=Soccer
// Retorna eventos do dia (nomes, horários, ligas, logos). Sem stats avançados.
// Suficiente para preencher a Home quando a API principal não trouxe o jogo.
// =====================================================================
const TSDB_CACHE_PREFIX = 'tsdb_cache_';
const TSDB_CACHE_TTL = 1000 * 60 * 60 * 6; // 6h

function tsdbToMatch(ev: any): MatchData | null {
  try {
    const id = String(ev.idEvent || '');
    const home = ev.strHomeTeam || '';
    const away = ev.strAwayTeam || '';
    if (!id || !home || !away) return null;
    // Hora em UTC quando disponível; senão, usa strTime local
    const iso = ev.strTimestamp
      ? new Date(ev.strTimestamp).toISOString()
      : `${ev.dateEvent || ''}T${ev.strTime || '00:00:00'}Z`;
    return {
      id: `tsdb-${id}`,
      time: iso,
      league: ev.strLeague || 'Outros',
      homeTeam: home,
      awayTeam: away,
      homeLogo: ev.strHomeTeamBadge || undefined,
      awayLogo: ev.strAwayTeamBadge || undefined,
      isLive: false,
    } as MatchData;
  } catch { return null; }
}

registerSource({
  name: 'thesportsdb-public',
  priority: 2,
  fetchByDate: async (date: string): Promise<MatchData[]> => {
    // cache curto (6h) para evitar bater no endpoint repetidamente
    try {
      const raw = localStorage.getItem(TSDB_CACHE_PREFIX + date);
      if (raw) {
        const { ts, data } = JSON.parse(raw);
        if (Date.now() - ts < TSDB_CACHE_TTL && Array.isArray(data)) return data;
      }
    } catch { /* noop */ }

    const url = `https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d=${encodeURIComponent(date)}&s=Soccer`;
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timeout);
      if (!res.ok) return [];
      const json = await res.json().catch(() => null);
      const events: any[] = Array.isArray(json?.events) ? json.events : [];
      const matches = events.map(tsdbToMatch).filter(Boolean) as MatchData[];
      try {
        localStorage.setItem(TSDB_CACHE_PREFIX + date, JSON.stringify({ ts: Date.now(), data: matches }));
      } catch { /* noop */ }
      return matches;
    } catch {
      clearTimeout(timeout);
      return [];
    }
  },
});

// =====================================================================
// FONTE 99 (CACHE EXPIRADO — ATIVA): rede de segurança final.
// =====================================================================
registerSource({
  name: 'stale-local-cache',
  priority: 99,
  fetchByDate: async (date: string): Promise<MatchData[]> => {
    try {
      const raw = localStorage.getItem(`football_cache_pre_${date}`);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  },
});

// =====================================================================
// PREPARADAS (NÃO ATIVAS) — descomente quando configurar o backend:
//   - rapidapi-football  (requer RAPIDAPI_FOOTBALL_KEY + edge function)
//   - sportmonks         (requer SPORTMONKS_TOKEN + edge function)
// =====================================================================
