// Liga Premium — lista e helpers
// NÃO altera lógica de análise. Apenas organização visual no pré-jogo.

export const PREMIUM_LEAGUES = new Set([
  'Bundesliga',
  'Eredivisie',
  'Jupiler Pro League',
  'Eliteserien',
  'Allsvenskan',
  'Championship',
  'Brasileirão Série A',
  'Brasileirão Série B',
  'Liga Argentina',
  'Superliga Dinamarca',
  'Bundesliga Áustria',
  'Super League Suíça',
  'Primeira Liga Portugal',
  'Ligue 1',
  'La Liga',
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
