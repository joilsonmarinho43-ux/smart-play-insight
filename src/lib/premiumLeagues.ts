// Liga Premium — lista e helpers
// NÃO altera lógica de análise. Apenas organização visual no pré-jogo.

export const PREMIUM_LEAGUES = new Set([
  // Top Europa
  'Premier League',
  'La Liga',
  'Bundesliga',
  'Serie A',
  'Serie A (ITA)',
  'Ligue 1',
  'Eredivisie',
  'Liga Portugal',
  'Primeira Liga Portugal',
  'Championship',
  'Jupiler Pro League',
  'Eliteserien',
  'Allsvenskan',
  'Superliga Dinamarca',
  'Bundesliga Áustria',
  'Super League Suíça',
  // Brasil
  'Brasileirão Série A',
  'Brasileirão Série B',
  // Américas
  'Liga Argentina',
  'Liga MX',
  'MLS',
  // Copas continentais
  'Copa Libertadores',
  'Copa Sudamericana',
  'Champions League',
  'Europa League',
]);

/** Verifica se uma liga é premium (case-insensitive, normaliza acentos) */
export function isPremiumLeague(leagueName: string): boolean {
  if (!leagueName) return false;
  const normalized = leagueName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  
  // Tentativa exata
  if (PREMIUM_LEAGUES.has(leagueName)) return true;
  
  // Tentativa normalizada (sem acentos)
  const normalizedSet = new Set(
    Array.from(PREMIUM_LEAGUES).map(l => 
      l.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    )
  );
  if (normalizedSet.has(normalized)) return true;
  
  // Substring match para variantes (ex: "Brasileirão" vs "Brasileirão Série A")
  for (const premium of PREMIUM_LEAGUES) {
    const pNorm = premium.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (normalized.includes(pNorm) || pNorm.includes(normalized)) return true;
  }
  
  return false;
}
