// ============================================================
// Superbet Connect — Configuração isolada
// Módulo opcional. Nada fora de /modules/superbet-connect ou
// /pages/SuperbetConnect.tsx deve importar deste arquivo.
// ============================================================

export const SUPERBET_CONNECT_ENABLED: boolean = (() => {
  const env = (import.meta.env.VITE_SUPERBET_CONNECT_ENABLED ?? '').toString().toLowerCase();
  if (env === 'false') return false;
  return true; // ON por padrão (beta)
})();

export const PARSER_VERSION = 'v0.1.0-stub';

export const ACCEPTED_SHARE_MIME = [
  'text/plain',
  'text/html',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
] as const;

export const SUPERBET_HOST_HINTS = [
  'superbet.bet.br',
  'superbet.com',
  'sb-br.com',
];

export const MARKET_KEYWORDS: Record<string, string[]> = {
  odds: ['odd', 'cotação', 'cotacao', '1x2', 'handicap', 'asiático', 'asiatico'],
  stats: ['posse', 'finalizações', 'finalizacoes', 'chutes', 'escanteios', 'cartões', 'cartoes', 'faltas'],
  h2h: ['confronto direto', 'h2h', 'últimos confrontos', 'ultimos confrontos'],
  lineup: ['escalação', 'escalacao', 'titulares', 'reservas', 'banco'],
  standings: ['classificação', 'classificacao', 'tabela', 'pontos corridos'],
  incidents: ['gol', 'cartão amarelo', 'cartao amarelo', 'cartão vermelho', 'cartao vermelho', 'substituição', 'substituicao'],
};
