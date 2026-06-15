// Tradução de nomes de seleções e times para o padrão usado pelas casas de aposta
// brasileiras (Bet365, Betano, Superbet, Pinnacle BR, etc.).
// Mantém o nome original quando não há tradução conhecida.

const NATION_PT: Record<string, string> = {
  // Europa
  'spain': 'Espanha',
  'england': 'Inglaterra',
  'france': 'França',
  'germany': 'Alemanha',
  'italy': 'Itália',
  'portugal': 'Portugal',
  'netherlands': 'Holanda',
  'holland': 'Holanda',
  'belgium': 'Bélgica',
  'switzerland': 'Suíça',
  'austria': 'Áustria',
  'denmark': 'Dinamarca',
  'sweden': 'Suécia',
  'norway': 'Noruega',
  'finland': 'Finlândia',
  'iceland': 'Islândia',
  'ireland': 'Irlanda',
  'republic of ireland': 'Irlanda',
  'northern ireland': 'Irlanda do Norte',
  'scotland': 'Escócia',
  'wales': 'País de Gales',
  'poland': 'Polônia',
  'czech republic': 'República Tcheca',
  'czechia': 'República Tcheca',
  'slovakia': 'Eslováquia',
  'slovenia': 'Eslovênia',
  'hungary': 'Hungria',
  'romania': 'Romênia',
  'bulgaria': 'Bulgária',
  'greece': 'Grécia',
  'turkey': 'Turquia',
  'türkiye': 'Turquia',
  'russia': 'Rússia',
  'ukraine': 'Ucrânia',
  'serbia': 'Sérvia',
  'croatia': 'Croácia',
  'bosnia and herzegovina': 'Bósnia e Herzegovina',
  'bosnia & herzegovina': 'Bósnia e Herzegovina',
  'montenegro': 'Montenegro',
  'north macedonia': 'Macedônia do Norte',
  'albania': 'Albânia',
  'kosovo': 'Kosovo',
  'moldova': 'Moldávia',
  'belarus': 'Bielorrússia',
  'estonia': 'Estônia',
  'latvia': 'Letônia',
  'lithuania': 'Lituânia',
  'georgia': 'Geórgia',
  'armenia': 'Armênia',
  'azerbaijan': 'Azerbaijão',
  'cyprus': 'Chipre',
  'malta': 'Malta',
  'luxembourg': 'Luxemburgo',
  'faroe islands': 'Ilhas Faroé',
  'gibraltar': 'Gibraltar',
  'andorra': 'Andorra',
  'san marino': 'San Marino',
  'liechtenstein': 'Liechtenstein',

  // América do Sul
  'brazil': 'Brasil',
  'argentina': 'Argentina',
  'uruguay': 'Uruguai',
  'paraguay': 'Paraguai',
  'chile': 'Chile',
  'colombia': 'Colômbia',
  'peru': 'Peru',
  'ecuador': 'Equador',
  'bolivia': 'Bolívia',
  'venezuela': 'Venezuela',

  // América do Norte / Central / Caribe
  'united states': 'Estados Unidos',
  'usa': 'Estados Unidos',
  'mexico': 'México',
  'canada': 'Canadá',
  'costa rica': 'Costa Rica',
  'panama': 'Panamá',
  'honduras': 'Honduras',
  'el salvador': 'El Salvador',
  'guatemala': 'Guatemala',
  'jamaica': 'Jamaica',
  'haiti': 'Haiti',
  'cuba': 'Cuba',
  'dominican republic': 'República Dominicana',
  'trinidad and tobago': 'Trinidad e Tobago',
  'curacao': 'Curaçao',

  // África
  'morocco': 'Marrocos',
  'egypt': 'Egito',
  'tunisia': 'Tunísia',
  'algeria': 'Argélia',
  'senegal': 'Senegal',
  'ivory coast': 'Costa do Marfim',
  'cote d\'ivoire': 'Costa do Marfim',
  'ghana': 'Gana',
  'nigeria': 'Nigéria',
  'cameroon': 'Camarões',
  'south africa': 'África do Sul',
  'mali': 'Mali',
  'burkina faso': 'Burkina Faso',
  'guinea': 'Guiné',
  'guinea-bissau': 'Guiné-Bissau',
  'equatorial guinea': 'Guiné Equatorial',
  'cape verde': 'Cabo Verde',
  'cape verde islands': 'Cabo Verde',
  'congo': 'Congo',
  'dr congo': 'RD Congo',
  'congo dr': 'RD Congo',
  'democratic republic of congo': 'RD Congo',
  'angola': 'Angola',
  'mozambique': 'Moçambique',
  'kenya': 'Quênia',
  'uganda': 'Uganda',
  'tanzania': 'Tanzânia',
  'ethiopia': 'Etiópia',
  'zambia': 'Zâmbia',
  'zimbabwe': 'Zimbábue',
  'gabon': 'Gabão',
  'togo': 'Togo',
  'benin': 'Benim',
  'sierra leone': 'Serra Leoa',
  'liberia': 'Libéria',
  'libya': 'Líbia',
  'sudan': 'Sudão',
  'south sudan': 'Sudão do Sul',
  'mauritania': 'Mauritânia',
  'namibia': 'Namíbia',
  'botswana': 'Botsuana',
  'madagascar': 'Madagascar',
  'comoros': 'Comores',
  'central african republic': 'República Centro-Africana',
  'rwanda': 'Ruanda',
  'burundi': 'Burundi',
  'malawi': 'Malaui',
  'eritrea': 'Eritreia',
  'somalia': 'Somália',
  'djibouti': 'Djibuti',
  'lesotho': 'Lesoto',
  'eswatini': 'Essuatíni',
  'swaziland': 'Essuatíni',
  'sao tome and principe': 'São Tomé e Príncipe',

  // Ásia / Oceania
  'japan': 'Japão',
  'south korea': 'Coreia do Sul',
  'korea republic': 'Coreia do Sul',
  'north korea': 'Coreia do Norte',
  'korea dpr': 'Coreia do Norte',
  'china': 'China',
  'china pr': 'China',
  'australia': 'Austrália',
  'new zealand': 'Nova Zelândia',
  'saudi arabia': 'Arábia Saudita',
  'iran': 'Irã',
  'iraq': 'Iraque',
  'qatar': 'Catar',
  'united arab emirates': 'Emirados Árabes Unidos',
  'uae': 'Emirados Árabes Unidos',
  'syria': 'Síria',
  'lebanon': 'Líbano',
  'jordan': 'Jordânia',
  'palestine': 'Palestina',
  'israel': 'Israel',
  'kuwait': 'Kuwait',
  'bahrain': 'Bahrein',
  'oman': 'Omã',
  'yemen': 'Iêmen',
  'india': 'Índia',
  'pakistan': 'Paquistão',
  'bangladesh': 'Bangladesh',
  'sri lanka': 'Sri Lanka',
  'nepal': 'Nepal',
  'afghanistan': 'Afeganistão',
  'thailand': 'Tailândia',
  'vietnam': 'Vietnã',
  'indonesia': 'Indonésia',
  'malaysia': 'Malásia',
  'singapore': 'Singapura',
  'philippines': 'Filipinas',
  'myanmar': 'Mianmar',
  'cambodia': 'Camboja',
  'laos': 'Laos',
  'mongolia': 'Mongólia',
  'kazakhstan': 'Cazaquistão',
  'uzbekistan': 'Uzbequistão',
  'turkmenistan': 'Turcomenistão',
  'kyrgyzstan': 'Quirguistão',
  'tajikistan': 'Tajiquistão',
  'fiji': 'Fiji',
  'solomon islands': 'Ilhas Salomão',
  'papua new guinea': 'Papua-Nova Guiné',
  'new caledonia': 'Nova Caledônia',
  'tahiti': 'Taiti',
  'vanuatu': 'Vanuatu',
};

// Sufixos como "U23", "W", "Women" — preserva
const SUFFIX_RE = /\s+(u\d{2}|sub[\s-]?\d{2}|women|w|feminin[oa]|reserves|ii)\s*$/i;

export function localizeTeamName(name: string | undefined | null): string {
  if (!name) return '';
  const raw = String(name).trim();
  if (!raw) return '';

  // Extrai sufixo (Sub-20, Women, etc.)
  let suffix = '';
  const m = raw.match(SUFFIX_RE);
  let core = raw;
  if (m) {
    suffix = ' ' + m[0].trim();
    core = raw.replace(SUFFIX_RE, '').trim();
  }

  const key = core.toLowerCase();
  const translated = NATION_PT[key];
  if (translated) return translated + suffix;

  // Tentativa: remove "Islands" duplicado, "National Team", etc.
  const cleaned = key
    .replace(/\s+national\s+team$/, '')
    .replace(/\s+islands$/, '');
  if (cleaned !== key && NATION_PT[cleaned]) return NATION_PT[cleaned] + suffix;

  return raw;
}

export function localizeTeams<T extends { homeTeam?: string; awayTeam?: string }>(obj: T): T {
  return {
    ...obj,
    homeTeam: localizeTeamName(obj.homeTeam) || obj.homeTeam,
    awayTeam: localizeTeamName(obj.awayTeam) || obj.awayTeam,
  };
}
