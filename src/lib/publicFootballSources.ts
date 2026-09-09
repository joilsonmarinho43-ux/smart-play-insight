/**
 * Public football data sources.
 *
 * DATA-ONLY boundary: this module never creates probabilities, confidence,
 * EV, signals or execution actions. Provider data must be normalized before
 * entering Nexus engines.
 *
 * Secondary sources currently supported:
 * - ESPN Site API: public scoreboard/summary endpoints.
 * - OpenLigaDB: public results API, no API key required.
 * - TheSportsDB v1: free/test read API.
 * - OpenFootAPI: public preview, limited results without authentication.
 *
 * These sources must not silently override the paid primary feed when
 * identities, timestamps or scores disagree.
 */

export type PublicFootballProvider = 'ESPN' | 'OPENLIGADB' | 'THESPORTSDB' | 'OPENFOOT';

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

export async function fetchEspnScoreboard(
  league: string,
  date?: string,
): Promise<PublicFootballFetchResult<unknown>> {
  const safeLeague = encodeURIComponent(league);
  const suffix = date ? `?dates=${encodeURIComponent(date)}` : '';
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${safeLeague}/scoreboard${suffix}`;
  return result('ESPN', await fetchJson<unknown>(url));
}

export async function fetchEspnSummary(
  league: string,
  eventId: string,
): Promise<PublicFootballFetchResult<unknown>> {
  const safeLeague = encodeURIComponent(league);
  const safeEvent = encodeURIComponent(eventId);
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${safeLeague}/summary?event=${safeEvent}`;
  return result('ESPN', await fetchJson<unknown>(url));
}

export async function fetchOpenLigaSeason(
  leagueShortcut: string,
  season: string,
): Promise<PublicFootballFetchResult<unknown>> {
  const league = encodeURIComponent(leagueShortcut);
  const safeSeason = encodeURIComponent(season);
  const url = `https://api.openligadb.de/getmatchdata/${league}/${safeSeason}`;
  return result('OPENLIGADB', await fetchJson<unknown>(url));
}

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
 * OpenFootAPI public preview. It intentionally exposes only the public
 * preview response and does not assume authenticated access.
 */
export async function fetchOpenFootMatches(date?: string): Promise<PublicFootballFetchResult<unknown>> {
  const suffix = date ? `?date=${encodeURIComponent(date)}` : '';
  const url = `https://openfootapi.com/v1/matches${suffix}`;
  return result('OPENFOOT', await fetchJson<unknown>(url));
}

export async function fetchOpenFootCompetitions(): Promise<PublicFootballFetchResult<unknown>> {
  return result('OPENFOOT', await fetchJson<unknown>('https://openfootapi.com/v1/competitions'));
}

export async function fetchPublicCrossChecks(input: {
  espn?: { league: string; date?: string };
  openLiga?: { leagueShortcut: string; season: string };
  sportsDb?: { leagueId: string; season: string };
  openFoot?: { date?: string };
}): Promise<PublicFootballFetchResult<unknown>[]> {
  const tasks: Promise<PublicFootballFetchResult<unknown>>[] = [];

  if (input.espn) tasks.push(fetchEspnScoreboard(input.espn.league, input.espn.date));
  if (input.openLiga) tasks.push(fetchOpenLigaSeason(input.openLiga.leagueShortcut, input.openLiga.season));
  if (input.sportsDb) tasks.push(fetchSportsDbSeason(input.sportsDb.leagueId, input.sportsDb.season));
  if (input.openFoot) tasks.push(fetchOpenFootMatches(input.openFoot.date));

  const settled = await Promise.allSettled(tasks);
  return settled
    .filter((item): item is PromiseFulfilledResult<PublicFootballFetchResult<unknown>> => item.status === 'fulfilled')
    .map(item => item.value);
}
