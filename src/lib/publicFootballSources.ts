/**
 * Public football data sources.
 *
 * This module is DATA-ONLY: it never creates probabilities, confidence,
 * EV, signals or execution actions. Raw provider data must pass through
 * the canonical normalizer before entering Nexus engines.
 *
 * Sources:
 * - ESPN Site API: public scoreboard/summary endpoints; no API key documented.
 * - OpenLigaDB: public football results API; no API key required.
 * - TheSportsDB v1: free/test API key 3 for limited read operations.
 *
 * These sources are secondary/fallback sources. They must not silently
 * override the paid primary feed when timestamps or identities disagree.
 */

export type PublicFootballProvider = 'ESPN' | 'OPENLIGADB' | 'THESPORTSDB';

export interface PublicFootballFetchResult<T> {
  provider: PublicFootballProvider;
  fetchedAt: string;
  data: T;
}

const DEFAULT_TIMEOUT_MS = 8_000;

async function fetchJson<T>(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`PUBLIC_FOOTBALL_HTTP_${response.status}`);
    }

    return await response.json() as T;
  } finally {
    clearTimeout(timer);
  }
}

function result<T>(provider: PublicFootballProvider, data: T): PublicFootballFetchResult<T> {
  return { provider, fetchedAt: new Date().toISOString(), data };
}

/**
 * ESPN scoreboard. Examples of league codes include eng.1, esp.1, ita.1,
 * ger.1 and fra.1. Keep this provider at the raw-data boundary.
 */
export async function fetchEspnScoreboard(
  league: string,
  date?: string,
): Promise<PublicFootballFetchResult<unknown>> {
  const safeLeague = encodeURIComponent(league);
  const suffix = date ? `?dates=${encodeURIComponent(date)}` : '';
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${safeLeague}/scoreboard${suffix}`;
  return result('ESPN', await fetchJson<unknown>(url));
}

/** Fetch an ESPN event summary, including the richer match report when available. */
export async function fetchEspnSummary(
  league: string,
  eventId: string,
): Promise<PublicFootballFetchResult<unknown>> {
  const safeLeague = encodeURIComponent(league);
  const safeEvent = encodeURIComponent(eventId);
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${safeLeague}/summary?event=${safeEvent}`;
  return result('ESPN', await fetchJson<unknown>(url));
}

/**
 * OpenLigaDB season feed. It is especially useful as an independent result
 * cross-check for supported leagues; it is not a replacement for live stats.
 */
export async function fetchOpenLigaSeason(
  leagueShortcut: string,
  season: string,
): Promise<PublicFootballFetchResult<unknown>> {
  const league = encodeURIComponent(leagueShortcut);
  const safeSeason = encodeURIComponent(season);
  const url = `https://api.openligadb.de/getmatchdata/${league}/${safeSeason}`;
  return result('OPENLIGADB', await fetchJson<unknown>(url));
}

/** TheSportsDB free v1 event list for a league/season. */
export async function fetchSportsDbSeason(
  leagueId: string,
  season: string,
): Promise<PublicFootballFetchResult<unknown>> {
  const safeLeague = encodeURIComponent(leagueId);
  const safeSeason = encodeURIComponent(season);
  const url = `https://www.thesportsdb.com/api/v1/json/3/eventsseason.php?id=${safeLeague}&s=${safeSeason}`;
  return result('THESPORTSDB', await fetchJson<unknown>(url));
}

/**
 * Fetch several independent sources without allowing one failure to hide the
 * others. Consumers decide how to reconcile identities/timestamps.
 */
export async function fetchPublicCrossChecks(input: {
  espn?: { league: string; date?: string };
  openLiga?: { leagueShortcut: string; season: string };
  sportsDb?: { leagueId: string; season: string };
}): Promise<PublicFootballFetchResult<unknown>[]> {
  const tasks: Promise<PublicFootballFetchResult<unknown>>[] = [];

  if (input.espn) tasks.push(fetchEspnScoreboard(input.espn.league, input.espn.date));
  if (input.openLiga) tasks.push(fetchOpenLigaSeason(input.openLiga.leagueShortcut, input.openLiga.season));
  if (input.sportsDb) tasks.push(fetchSportsDbSeason(input.sportsDb.leagueId, input.sportsDb.season));

  const settled = await Promise.allSettled(tasks);
  return settled
    .filter((item): item is PromiseFulfilledResult<PublicFootballFetchResult<unknown>> => item.status === 'fulfilled')
    .map(item => item.value);
}
