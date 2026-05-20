import { analyzeMarkets } from './matchAnalysis';
import type { MatchData, MarketAnalysis } from '@/types/match';

export interface ReadingOpportunity {
  market: string;
  confidence: number;
  reasons: string[];
}

export interface MatchReading {
  summary: string;
  indicators: string[];
  marketRead: string;
  opportunities: ReadingOpportunity[];
  alerts: string[];
  likelyScores: string[];
  timing: { pressure: string; acceleration: string };
}

// Deterministic pseudo-random based on match id (so a same match always
// gets the same phrasing variation, but different matches differ).
function seedFromString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}
function pick<T>(arr: T[], seed: number, offset = 0): T {
  const idx = Math.floor(((seed * 1000 + offset) % arr.length + arr.length) % arr.length);
  return arr[idx];
}

function factorial(n: number): number {
  if (n <= 1) return 1;
  let r = 1; for (let i = 2; i <= n; i++) r *= i; return r;
}
function poisson(lambda: number, k: number): number {
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
}

function topScores(homeLambda: number, awayLambda: number, n = 3): string[] {
  const items: { h: number; a: number; p: number }[] = [];
  for (let h = 0; h <= 5; h++)
    for (let a = 0; a <= 5; a++)
      items.push({ h, a, p: poisson(homeLambda, h) * poisson(awayLambda, a) });
  items.sort((x, y) => y.p - x.p);
  return items.slice(0, n).map((s) => `${s.h}-${s.a}`);
}

export function buildMatchReading(match: MatchData): MatchReading {
  const seed = seedFromString(String((match as any).id || match.homeTeam + match.awayTeam));
  const home = match.homeTeam || 'Mandante';
  const away = match.awayTeam || 'Visitante';

  const markets: MarketAnalysis[] = (() => {
    try { return analyzeMarkets(match); } catch { return []; }
  })();

  const hGF = match.modelData?.homeGoalsAvg ?? (match as any).homeStats?.goalsFor ?? 1.3;
  const aGF = match.modelData?.awayGoalsAvg ?? (match as any).awayStats?.goalsFor ?? 1.1;
  const hGA = match.modelData?.homeGoalsAgainstAvg ?? (match as any).homeStats?.goalsAgainst ?? 1.2;
  const aGA = match.modelData?.awayGoalsAgainstAvg ?? (match as any).awayStats?.goalsAgainst ?? 1.3;
  const hCorners = match.modelData?.homeCornersAvg ?? 0;
  const aCorners = match.modelData?.awayCornersAvg ?? 0;

  const homeLambda = Math.max(0.3, (hGF + aGA) / 2);
  const awayLambda = Math.max(0.2, (aGF + hGA) / 2);
  const totalLambda = homeLambda + awayLambda;

  // --- Resumo
  const diff = homeLambda - awayLambda;
  const stronger = diff > 0.25 ? home : diff < -0.25 ? away : null;
  const summaryVariants = [
    stronger
      ? `${stronger} chega com leitura ofensiva mais consistente e tende a ditar o ritmo da partida.`
      : `Confronto equilibrado, com leituras ofensivas próximas entre ${home} e ${away}.`,
    stronger
      ? `Os números recentes colocam o ${stronger} um passo à frente, especialmente na criação.`
      : `Sem favorito claro nos números: jogo aberto e decidido nos detalhes.`,
    totalLambda > 2.6
      ? `Tendência clara de jogo aberto e produtivo no setor ofensivo.`
      : totalLambda < 1.9
      ? `Cenário aponta para um duelo mais controlado, com poucos espaços.`
      : `Partida com potencial ofensivo moderado, sem extremos previstos.`,
  ];
  const summary = `${summaryVariants[0]} ${summaryVariants[2]}`;

  // --- Indicadores
  const indicators: string[] = [];
  if (totalLambda >= 2.7) indicators.push('Alta expectativa de gols (projeção combinada acima da média)');
  if (homeLambda >= 1.6) indicators.push(`Mandante com forte produção esperada em casa`);
  if (awayLambda >= 1.4) indicators.push(`Visitante consistente fora de casa`);
  if (hGA >= 1.5 || aGA >= 1.5) indicators.push('Defesas vulneráveis sob pressão');
  if (hCorners + aCorners >= 9) indicators.push('Tendência elevada de escanteios');
  const bttsMkt = markets.find((m) => m.market === 'Ambas Marcam');
  if (bttsMkt && bttsMkt.probability >= 60) indicators.push('Cenário favorável para Ambas Marcam');
  const homeWinMkt = markets.find((m) => m.market === 'Vitória Casa');
  const awayWinMkt = markets.find((m) => m.market === 'Vitória Fora');
  if (homeWinMkt && homeWinMkt.probability >= 55) indicators.push('Mandante com domínio estatístico');
  if (awayWinMkt && awayWinMkt.probability >= 55) indicators.push('Visitante com vantagem nos números');
  if (indicators.length === 0) indicators.push('Cenário equilibrado, sem destaques estatísticos extremos');

  // --- Leitura de mercado
  const o25 = markets.find((m) => m.market === 'Over 2.5 Gols')?.probability ?? 0;
  const marketReads = [
    o25 >= 65
      ? `Os números indicam valor consistente no mercado de gols, com projeção acima do que as odds tradicionais costumam refletir.`
      : o25 <= 40
      ? `Mercado de gols aparece sem valor claro — projeção abaixo do necessário para uma entrada confortável.`
      : `Mercado de gols mostra equilíbrio: existe espaço, mas exige seletividade na entrada.`,
    stronger
      ? `O favoritismo do ${stronger} já está precificado pelo mercado, reduzindo margem em vitória direta.`
      : `Sem favorito claro nas odds, o melhor risco/retorno tende a estar nos mercados alternativos.`,
  ];
  const marketRead = `${pick(marketReads, seed, 0)} ${pick(marketReads, seed, 1)}`;

  // --- Oportunidades
  const sorted = [...markets].sort((a, b) => b.probability - a.probability);
  const top = sorted.slice(0, 3);
  const opportunities: ReadingOpportunity[] = top.map((m) => {
    const reasons: string[] = [];
    if (m.market.includes('Over')) {
      if (totalLambda >= 2.5) reasons.push('projeção combinada de gols acima da média');
      if (hGA >= 1.3 || aGA >= 1.3) reasons.push('defesas com histórico de sofrer gols');
      if (m.market.includes('Cantos')) reasons.push('volume médio de escanteios elevado');
    }
    if (m.market === 'Ambas Marcam') {
      reasons.push('ataques produtivos dos dois lados');
      if (hGA >= 1.2 && aGA >= 1.2) reasons.push('vulnerabilidade defensiva mútua');
    }
    if (m.market.startsWith('Vitória')) {
      reasons.push('superioridade nos indicadores ofensivos recentes');
      if (m.market === 'Vitória Casa') reasons.push('peso do fator mandante');
    }
    if (m.market.startsWith('Handicap')) reasons.push('diferença técnica refletida no projeção de placar');
    if (m.market.startsWith('1X') || m.market.startsWith('X2')) reasons.push('rota de menor risco dentro do confronto');
    if (reasons.length === 0) reasons.push('cenário estatístico favorável dentro do modelo');
    return { market: m.market, confidence: m.probability, reasons: reasons.slice(0, 3) };
  });

  // --- Alertas
  const alerts: string[] = [];
  if (stronger) alerts.push(`Possível controle excessivo do ${stronger} após abrir vantagem.`);
  if (totalLambda < 2.0) alerts.push('Jogo pode começar truncado e demorar para se abrir.');
  if (totalLambda > 3.2) alerts.push('Atenção ao ritmo: jogos muito abertos costumam virar imprevisíveis.');
  if (hGA <= 0.9 && aGA <= 0.9) alerts.push('Duelo entre defesas sólidas — paciência na entrada de Over.');
  if (alerts.length === 0) alerts.push('Sem sinais de alerta evidentes no momento.');

  // --- Placares prováveis
  const likelyScores = topScores(homeLambda, awayLambda, 3);

  // --- Timing
  const timing = {
    pressure: totalLambda >= 2.6 ? '20’–40’' : '25’–45’',
    acceleration: stronger === away ? '55’–70’' : '60’–80’',
  };

  return { summary, indicators, marketRead, opportunities, alerts, likelyScores, timing };
}
