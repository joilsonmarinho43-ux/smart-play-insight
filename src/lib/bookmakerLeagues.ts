// Ligas com cobertura confiável nas casas de aposta (Bet365, Betano, Superbet...).
// Usado para não sugerir jogos que o usuário não consegue encontrar para apostar.

import { isPremiumLeague } from '@/lib/premiumLeagues';

/** Termos que indicam competição sem mercado nas casas (ou mercado muito raso). */
const NOT_TRADABLE = [
  'u15', 'u16', 'u17', 'u18', 'u19', 'u20', 'u21', 'u23',
  'sub-15', 'sub-16', 'sub-17', 'sub-18', 'sub-19', 'sub-20', 'sub-21', 'sub-23',
  'youth', 'juvenil', 'junior', 'juniores',
  'reserve', 'reserva', 'ii', ' b ', ' b)', 'amateur', 'amador',
  'women', 'feminino', 'feminina', 'femenina', 'ladies', 'frauen', 'dames',
  'friendly', 'friendlies', 'amistoso', 'amistosos',
  'futsal', 'indoor', 'beach',
  'regional', 'state league', 'county', 'district',
  'trial', 'test match',
];

/** Competições/ligas nacionais e continentais com mercado amplo. */
const TRADABLE_PATTERNS = [
  // Continentais / mundiais
  'champions league', 'europa league', 'conference league', 'super cup', 'supercopa',
  'libertadores', 'sudamericana', 'recopa', 'concacaf', 'afc champions', 'caf champions',
  'world cup', 'copa do mundo', 'euro', 'copa america', 'nations league', 'qualification',
  'eliminatórias', 'eliminatorias',
  // Europa
  'premier league', 'championship', 'league one', 'league two', 'fa cup', 'efl cup', 'carabao',
  'la liga', 'laliga', 'segunda division', 'copa del rey',
  'serie a', 'serie b', 'coppa italia',
  'bundesliga', '2. bundesliga', 'dfb pokal', 'dfb-pokal',
  'ligue 1', 'ligue 2', 'coupe de france',
  'eredivisie', 'keuken kampioen', 'knvb',
  'primeira liga', 'liga portugal', 'taça de portugal', 'taca de portugal',
  'jupiler', 'pro league', 'super lig', 'süper lig', 'superliga', 'super league',
  'allsvenskan', 'eliteserien', 'veikkausliiga', 'ekstraklasa', 'fortuna liga',
  'premiership', 'scottish', 'bundesliga austria', 'bundesliga áustria',
  'russian premier', 'ukrainian premier', 'greek', 'hnl',
  // Américas
  'brasileirão', 'brasileirao', 'copa do brasil', 'liga profesional', 'primera division',
  'liga mx', 'mls', 'liga betplay', 'liga pro', 'primera a', 'usl championship',
  // Ásia / Oceania
  'j1 league', 'j-league', 'k league', 'a-league', 'saudi pro league', 'qatar stars',
  'chinese super league', 'indian super league',
];

function norm(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** A liga tem mercado real nas casas de aposta? */
export function isBookmakerLeague(leagueName: string): boolean {
  const l = norm(leagueName);
  if (!l) return false;
  if (NOT_TRADABLE.some(t => l.includes(norm(t)))) return false;
  if (isPremiumLeague(leagueName)) return true;
  return TRADABLE_PATTERNS.some(p => l.includes(norm(p)));
}
