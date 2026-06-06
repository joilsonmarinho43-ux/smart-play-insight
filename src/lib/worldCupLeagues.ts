// Identifica ligas/competições de seleções tratadas exclusivamente
// na seção "Copa do Mundo" do sidebar (/world-cup).
// Esses jogos NÃO devem aparecer no Pré-Jogo, Scanner, Elite ou Bingo.

const WC_LEAGUE_PATTERNS = [
  'world cup',
  'copa do mundo',
  'friendlies',
  'amistoso',
  'international',
  'eliminat',
  'qualification',
];

export function isWorldCupLeague(league: any): boolean {
  const name = (league?.name || league || '').toString().toLowerCase();
  if (!name) return false;
  return WC_LEAGUE_PATTERNS.some(p => name.includes(p));
}
