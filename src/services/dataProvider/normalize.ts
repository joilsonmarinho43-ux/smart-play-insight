// Normalização de nomes de equipes e ligas.
// Reconhece variações como "Flamengo", "CR Flamengo", "Flamengo RJ", "Flamengo-RJ"
// como a mesma entidade. Usado para deduplicar/cruzar dados entre fontes diferentes.

const TEAM_PREFIXES = [
  'cr', 'cf', 'fc', 'sc', 'ac', 'as', 'sk', 'sv', 'ss', 'ec', 'ce',
  'club', 'clube', 'atletico', 'athletic', 'real', 'racing',
  'sociedade', 'esporte', 'esportivo', 'associacao', 'asociacion',
];

const TEAM_SUFFIXES = [
  'fc', 'sc', 'ec', 'cf', 'ac', 'sa', 'ltd', 'b', 'ii',
  'rj', 'sp', 'mg', 'rs', 'pr', 'sc', 'ba', 'ce', 'pe', 'go', 'df',
  'ng', 'cd', 'mx', 'ar', 'br', 'us',
];

const STOP_WORDS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'la', 'el', 'le', 'les', 'der', 'die', 'das',
  'and', 'e', 'y', '&', 'the',
]);

const stripDiacritics = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export function normalizeTeamName(name: string | undefined | null): string {
  if (!name) return '';
  let s = stripDiacritics(String(name)).toLowerCase().trim();
  // Remove parenthetical/bracketed suffixes: "Flamengo (RJ)"
  s = s.replace(/[()[\]{}]/g, ' ');
  // Hyphens / dots / slashes → space
  s = s.replace(/[-./]/g, ' ');
  // Keep alnum + spaces
  s = s.replace(/[^a-z0-9\s]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();

  const tokens = s.split(' ').filter(Boolean).filter(t => !STOP_WORDS.has(t));

  // Drop leading common prefixes (cr, fc, etc) — only if not the entire name
  while (tokens.length > 1 && TEAM_PREFIXES.includes(tokens[0])) tokens.shift();
  // Drop trailing region/short suffixes
  while (tokens.length > 1 && TEAM_SUFFIXES.includes(tokens[tokens.length - 1])) tokens.pop();

  return tokens.join(' ');
}

export function teamsMatch(a: string, b: string): boolean {
  const na = normalizeTeamName(a);
  const nb = normalizeTeamName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Substring containment (one is a shortened form of the other)
  if (na.length >= 4 && nb.includes(na)) return true;
  if (nb.length >= 4 && na.includes(nb)) return true;
  return false;
}

export function normalizeLeagueName(name: string | undefined | null): string {
  if (!name) return '';
  let s = stripDiacritics(String(name)).toLowerCase().trim();
  s = s.replace(/serie\s+/g, 'serie ');
  s = s.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return s;
}

export function matchSignature(homeTeam: string, awayTeam: string, dateISO?: string): string {
  const h = normalizeTeamName(homeTeam);
  const a = normalizeTeamName(awayTeam);
  const d = dateISO ? new Date(dateISO).toISOString().slice(0, 10) : '';
  return `${d}::${h}__vs__${a}`;
}
