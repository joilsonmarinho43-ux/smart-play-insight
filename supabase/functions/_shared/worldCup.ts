/**
 * Shared World Cup / FIFA detector for server-side pipelines.
 *
 * Garante que partidas da Copa do Mundo FIFA (em todas as variações
 * retornadas pelas APIs) sejam reconhecidas como competição prioritária
 * e NUNCA descartadas pelos filtros de "ligas instáveis".
 *
 * Sempre que um filtro/blacklist for aplicado a uma liga, antes
 * cheque `isWorldCupLeague(name)` — se for true, bypass o filtro.
 */
const WORLD_CUP_PATTERNS = [
  'fifa world cup',
  'world cup',
  'copa do mundo',
  'mundial',
  'fifa',
  // Eliminatórias / qualifiers
  'wc qualif',
  'world cup qualif',
  'wcq',
  'eliminat',
  'qualification',
  'qualifier',
];

export function isWorldCupLeague(leagueOrObj: any): boolean {
  if (!leagueOrObj) return false;
  const raw = typeof leagueOrObj === 'string'
    ? leagueOrObj
    : (leagueOrObj?.name || leagueOrObj?.league || '');
  const name = String(raw).toLowerCase();
  if (!name) return false;
  return WORLD_CUP_PATTERNS.some(p => name.includes(p));
}

/** API-Sports league IDs conhecidos como Copa do Mundo / Eliminatórias. */
export const WORLD_CUP_LEAGUE_IDS = new Set<number>([
  1,   // FIFA World Cup
  10,  // Friendlies International (preparação WC)
  32,  // World Cup Qualifiers - Europe
  9,   // World Cup Qualifiers (intercontinental)
  29,  // World Cup Qualifiers - South America (algumas temporadas)
  31,  // CONCACAF
  33,  // AFC
  34,  // CAF
  37,  // Play-offs
]);

export function isWorldCupLeagueId(id: number | undefined | null): boolean {
  return typeof id === 'number' && WORLD_CUP_LEAGUE_IDS.has(id);
}
