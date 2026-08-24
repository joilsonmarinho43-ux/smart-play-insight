// Limpa os caches locais de partidas (pré-jogo) para forçar uma busca nova
// nas fontes (SportsRC, ESPN, TheSportsDB, Football-Data...).

const CACHE_PREFIXES = [
  'football_cache_pre',      // footballApi (pré-jogo por data)
  'sportsrc_',               // SportsRC
  'sportsrc_stale_',
  'espn_fix_',               // ESPN Fixtures
  'tsdb_day_',               // TheSportsDB
  'fdo_',                    // Football-Data.org
  'wc_fallback_',            // Copa do Mundo
];

export function clearMatchCaches(): number {
  let removed = 0;
  try {
    const keys = Object.keys(localStorage);
    for (const k of keys) {
      if (CACHE_PREFIXES.some((p) => k.startsWith(p))) {
        localStorage.removeItem(k);
        removed++;
      }
    }
  } catch { /* noop */ }
  return removed;
}
