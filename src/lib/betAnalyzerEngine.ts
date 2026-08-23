// 🎯 BET ANALYZER — seleciona 5 partidas distintas, uma por cenário.
// Regras de integridade:
//  • Só usa números reais já presentes na partida (histórico dos últimos jogos,
//    médias de gols, amostra). Nunca inventa xG ou estatísticas ausentes.
//  • Se um cenário não tiver partida com dados suficientes, retorna null.
//  • Nenhuma partida se repete entre cenários.

import { buildCorrectScore, extractLambdas, type CorrectScoreRead } from '@/lib/correctScoreEngine';

export type ScenarioKey = 'correct_score' | 'btts' | 'goals25' | 'result' | 'upset';

export interface ScenarioMeta {
  key: ScenarioKey;
  icon: string;
  title: string;
  order: number;
}

export const SCENARIOS: ScenarioMeta[] = [
  { key: 'correct_score', icon: '⚽', title: 'Placar Exato', order: 1 },
  { key: 'btts', icon: '🎯', title: 'Ambas Marcam', order: 2 },
  { key: 'goals25', icon: '⚽', title: 'Total de Gols 2.5', order: 3 },
  { key: 'result', icon: '🏆', title: 'Resultado da Partida', order: 4 },
  { key: 'upset', icon: '🦓', title: 'Zebra', order: 5 },
];

export interface AnalyzedMatch {
  id: string;
  league: string;
  country?: string;
  time: string;
  iso: string | null;
  live: boolean;
  homeTeam: string;
  awayTeam: string;
  sample: { home: number; away: number };
  history: {
    homeGF: number[]; homeGA: number[];
    awayGF: number[]; awayGA: number[];
  };
  read: CorrectScoreRead;
}

/** Indicador dedicado do mercado (0-100) com os componentes que o sustentam. */
export interface CardIndicator {
  label: string;                 // ex.: "Índice de Zebra"
  value: number;                 // 0-100
  level: 'FORTE' | 'MÉDIO' | 'FRACO';
  caption: string;               // leitura curta do indicador
  components: { label: string; value: number }[]; // 0-100 cada
}

export interface ScenarioCard {
  scenario: ScenarioMeta;
  match: AnalyzedMatch;
  headline: string;             // resultado da análise (ex.: "OVER 2.5")
  score: number;                // Score Nexus 0-100
  rating: string;               // classificação textual
  quality: 'ALTA' | 'MÉDIA' | 'BAIXA';
  indicator: CardIndicator;     // indicador específico do mercado
  stats: { label: string; value: string }[];
  pros: string[];
  cons: string[];
  why: string;
  recent: { label: string; values: string }[];
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const arr = (v: unknown): number[] =>
  Array.isArray(v) ? v.map(Number).filter((n) => Number.isFinite(n) && n >= 0) : [];

const freq = (list: boolean[]): number | null =>
  list.length ? list.filter(Boolean).length / list.length : null;

const pctTxt = (v: number) => `${Math.round(v * 100)}%`;

/** Média ponderada dos indicadores disponíveis (pesos redistribuídos). */
function weighted(parts: { w: number; v: number | null }[]): number {
  let sw = 0, s = 0;
  for (const p of parts) {
    if (p.v === null || !Number.isFinite(p.v)) continue;
    sw += p.w; s += p.w * p.v;
  }
  return sw > 0 ? s / sw : 0;
}

export function ratingOf(score: number): string {
  if (score >= 90) return 'EXCELENTE CONSISTÊNCIA';
  if (score >= 80) return 'MUITO FORTE';
  if (score >= 70) return 'FORTE';
  if (score >= 60) return 'MODERADA';
  return 'BAIXA';
}

function qualityOf(sample: { home: number; away: number }, hist: AnalyzedMatch['history']): 'ALTA' | 'MÉDIA' | 'BAIXA' {
  const games = Math.min(sample.home, sample.away);
  const listed = Math.min(hist.homeGF.length, hist.awayGF.length);
  if (games >= 5 && listed >= 5) return 'ALTA';
  if (games >= 3) return 'MÉDIA';
  return 'BAIXA';
}

/** Normaliza uma partida crua (já enriquecida) para o formato do módulo. */
export function toAnalyzed(m: any, opts: { time: string; iso: string | null; league: string; country?: string; live: boolean; homeTeam: string; awayTeam: string }): AnalyzedMatch {
  const hs = m?.homeStats || {};
  const as_ = m?.awayStats || {};
  const read = buildCorrectScore(m);
  return {
    id: String(m?.id ?? m?.fixture?.id ?? `${opts.homeTeam}-${opts.awayTeam}`),
    league: opts.league,
    country: opts.country,
    time: opts.time,
    iso: opts.iso,
    live: opts.live,
    homeTeam: opts.homeTeam,
    awayTeam: opts.awayTeam,
    sample: read.sample,
    history: {
      homeGF: arr(hs.recentGoalsFor),
      homeGA: arr(hs.recentGoalsAgainst),
      awayGF: arr(as_.recentGoalsFor),
      awayGA: arr(as_.recentGoalsAgainst),
    },
    read,
  };
}

/** Amostra mínima para qualquer cenário. */
function eligible(m: AnalyzedMatch): boolean {
  return m.read.hasRealData && Math.min(m.sample.home, m.sample.away) >= 3;
}

function sampleFactor(m: AnalyzedMatch): number {
  const g = Math.min(m.sample.home, m.sample.away);
  return g >= 6 ? 1 : g >= 5 ? 0.95 : g >= 4 ? 0.85 : 0.72;
}

/** Consistência = 1 - dispersão relativa dos gols recentes. */
function consistency(list: number[]): number | null {
  if (list.length < 3) return null;
  const mean = list.reduce((a, b) => a + b, 0) / list.length;
  const varc = list.reduce((a, b) => a + (b - mean) ** 2, 0) / list.length;
  const sd = Math.sqrt(varc);
  return Math.max(0, Math.min(1, 1 - sd / (mean + 1.2)));
}

function pairHistory(m: AnalyzedMatch) {
  const n = Math.min(m.history.homeGF.length, m.history.homeGA.length);
  const k = Math.min(m.history.awayGF.length, m.history.awayGA.length);
  const homeGames = Array.from({ length: n }, (_, i) => ({ gf: m.history.homeGF[i], ga: m.history.homeGA[i] }));
  const awayGames = Array.from({ length: k }, (_, i) => ({ gf: m.history.awayGF[i], ga: m.history.awayGA[i] }));
  return { homeGames, awayGames };
}

/* ------------------------------------------------------------------ */
/* Cenários                                                            */
/* ------------------------------------------------------------------ */

function buildCorrectScoreCard(m: AnalyzedMatch): ScenarioCard | null {
  const r = m.read;
  const best = r.top[0];
  if (!best) return null;
  const cons = weighted([
    { w: 1, v: consistency(m.history.homeGF) },
    { w: 1, v: consistency(m.history.awayGF) },
  ]);
  const score = Math.round(
    100 * weighted([
      { w: 20, v: Math.min(1, r.comboProb / 0.45) },        // concentração do topo
      { w: 20, v: Math.min(1, best.prob / 0.16) },          // força do placar líder
      { w: 15, v: cons || null },                            // consistência ofensiva
      { w: 15, v: Math.min(1, 1 / Math.max(0.6, (r.homeLambda + r.awayLambda) / 2.4)) },
      { w: 15, v: sampleFactor(m) },
      { w: 15, v: r.confidence / 100 },
    ]),
  );
  const pros = [
    `Top-3 placares concentram ${pctTxt(r.comboProb)} da probabilidade.`,
    `Gols esperados ${r.homeLambda.toFixed(2)} x ${r.awayLambda.toFixed(2)}.`,
  ];
  if (cons > 0.6) pros.push('Produção ofensiva estável nos últimos jogos.');
  const consList: string[] = [];
  if (r.homeLambda + r.awayLambda >= 3.2) consList.push('Jogo aberto reduz a precisão do placar exato.');
  if (Math.min(m.sample.home, m.sample.away) < 5) consList.push('Amostra abaixo de 5 jogos por equipe.');
  if (best.prob < 0.12) consList.push('Nenhum placar domina claramente a distribuição.');
  return {
    scenario: SCENARIOS[0],
    match: m,
    headline: `${m.homeTeam} ${best.home} x ${best.away} ${m.awayTeam}`,
    score, rating: ratingOf(score), quality: qualityOf(m.sample, m.history),
    stats: [
      { label: 'Prob. do placar', value: pctTxt(best.prob) },
      { label: 'Odd justa', value: best.fairOdd.toFixed(2) },
      { label: 'Alternativas', value: r.top.slice(1, 3).map((c) => `${c.home}-${c.away}`).join(' · ') },
      { label: 'Jogos analisados', value: `${m.sample.home} + ${m.sample.away}` },
    ],
    pros, cons: consList,
    why: `Distribuição de gols mais concentrada entre os jogos do dia (top-3 = ${pctTxt(r.comboProb)}), com médias reais de ${m.sample.home}/${m.sample.away} jogos.`,
    recent: recentRows(m),
  };
}

function buildBttsCard(m: AnalyzedMatch): ScenarioCard | null {
  const { homeGames, awayGames } = pairHistory(m);
  if (homeGames.length < 3 || awayGames.length < 3) return null;
  const bttsHome = freq(homeGames.map((g) => g.gf > 0 && g.ga > 0));
  const bttsAway = freq(awayGames.map((g) => g.gf > 0 && g.ga > 0));
  const scoredHome = freq(homeGames.map((g) => g.gf > 0));
  const scoredAway = freq(awayGames.map((g) => g.gf > 0));
  const csHome = freq(homeGames.map((g) => g.ga === 0));
  const csAway = freq(awayGames.map((g) => g.ga === 0));
  const model = m.read.btts;
  const yes = model >= 0.5;
  const support = yes ? model : 1 - model;
  const histSupport = weighted([
    { w: 1, v: yes ? bttsHome : bttsHome === null ? null : 1 - bttsHome },
    { w: 1, v: yes ? bttsAway : bttsAway === null ? null : 1 - bttsAway },
  ]);
  const score = Math.round(100 * weighted([
    { w: 25, v: Math.min(1, (support - 0.45) / 0.35) },
    { w: 25, v: histSupport || null },
    { w: 15, v: yes ? weighted([{ w: 1, v: scoredHome }, { w: 1, v: scoredAway }]) : null },
    { w: 15, v: yes ? null : weighted([{ w: 1, v: csHome }, { w: 1, v: csAway }]) },
    { w: 20, v: sampleFactor(m) },
  ]));
  const pros: string[] = [];
  if (bttsHome !== null) pros.push(`${m.homeTeam}: BTTS em ${pctTxt(bttsHome)} dos últimos ${homeGames.length} jogos.`);
  if (bttsAway !== null) pros.push(`${m.awayTeam}: BTTS em ${pctTxt(bttsAway)} dos últimos ${awayGames.length} jogos.`);
  const consList: string[] = [];
  if (yes && csHome !== null && csHome >= 0.4) consList.push(`${m.homeTeam} tem ${pctTxt(csHome)} de jogos sem sofrer gol.`);
  if (yes && csAway !== null && csAway >= 0.4) consList.push(`${m.awayTeam} tem ${pctTxt(csAway)} de jogos sem sofrer gol.`);
  if (!yes && scoredHome !== null && scoredAway !== null && Math.min(scoredHome, scoredAway) > 0.8)
    consList.push('Ambas marcaram na maioria dos jogos recentes.');
  return {
    scenario: SCENARIOS[1], match: m,
    headline: yes ? 'AMBAS MARCAM — SIM' : 'AMBAS MARCAM — NÃO',
    score, rating: ratingOf(score), quality: qualityOf(m.sample, m.history),
    stats: [
      { label: 'Modelo (BTTS sim)', value: pctTxt(m.read.btts) },
      { label: 'Prob. 0x0', value: pctTxt(m.read.matrix.find((c) => c.home === 0 && c.away === 0)?.prob ?? 0) },
      { label: 'Marcou (casa/fora)', value: `${scoredHome !== null ? pctTxt(scoredHome) : '—'} / ${scoredAway !== null ? pctTxt(scoredAway) : '—'}` },
      { label: 'Clean sheets', value: `${csHome !== null ? pctTxt(csHome) : '—'} / ${csAway !== null ? pctTxt(csAway) : '—'}` },
    ],
    pros, cons: consList,
    why: `Histórico recente das duas equipes é o que mais reforça o cenário ${yes ? 'SIM' : 'NÃO'} entre os jogos do dia.`,
    recent: recentRows(m),
  };
}

function buildGoals25Card(m: AnalyzedMatch): ScenarioCard | null {
  const { homeGames, awayGames } = pairHistory(m);
  if (homeGames.length < 3 || awayGames.length < 3) return null;
  const overHome = freq(homeGames.map((g) => g.gf + g.ga >= 3));
  const overAway = freq(awayGames.map((g) => g.gf + g.ga >= 3));
  const model = m.read.over25;
  const over = model >= 0.5;
  const support = over ? model : 1 - model;
  const hist = weighted([
    { w: 1, v: over ? overHome : overHome === null ? null : 1 - overHome },
    { w: 1, v: over ? overAway : overAway === null ? null : 1 - overAway },
  ]);
  const avgGoals = (m.read.homeLambda + m.read.awayLambda);
  const score = Math.round(100 * weighted([
    { w: 30, v: Math.min(1, (support - 0.45) / 0.32) },
    { w: 30, v: hist || null },
    { w: 20, v: sampleFactor(m) },
    { w: 20, v: consistency([...m.history.homeGF, ...m.history.awayGF]) },
  ]));
  const pros: string[] = [`Gols esperados totais: ${avgGoals.toFixed(2)}.`];
  if (overHome !== null) pros.push(`${m.homeTeam}: Over 2.5 em ${pctTxt(overHome)} dos jogos.`);
  if (overAway !== null) pros.push(`${m.awayTeam}: Over 2.5 em ${pctTxt(overAway)} dos jogos.`);
  const consList: string[] = [];
  if (support < 0.6) consList.push('Margem estatística estreita entre Over e Under.');
  if (Math.min(m.sample.home, m.sample.away) < 5) consList.push('Amostra abaixo de 5 jogos por equipe.');
  return {
    scenario: SCENARIOS[2], match: m,
    headline: over ? 'OVER 2.5' : 'UNDER 2.5',
    score, rating: ratingOf(score), quality: qualityOf(m.sample, m.history),
    stats: [
      { label: 'Over 2.5 (modelo)', value: pctTxt(m.read.over25) },
      { label: 'Under 2.5 (modelo)', value: pctTxt(m.read.under25) },
      { label: 'Freq. Over (casa/fora)', value: `${overHome !== null ? pctTxt(overHome) : '—'} / ${overAway !== null ? pctTxt(overAway) : '—'}` },
      { label: 'Média de gols projetada', value: avgGoals.toFixed(2) },
    ],
    pros, cons: consList,
    why: `Frequência real de ${over ? 'Over' : 'Under'} 2.5 nos últimos ${homeGames.length}/${awayGames.length} jogos alinhada à projeção do modelo.`,
    recent: recentRows(m),
  };
}

function buildResultCard(m: AnalyzedMatch): ScenarioCard | null {
  const { homeGames, awayGames } = pairHistory(m);
  if (homeGames.length < 3 || awayGames.length < 3) return null;
  const o = m.read.outcome;
  const entries: [string, number][] = [['CASA', o.home], ['EMPATE', o.draw], ['FORA', o.away]];
  entries.sort((a, b) => b[1] - a[1]);
  const [pick, prob] = entries[0];
  const winHome = freq(homeGames.map((g) => g.gf > g.ga));
  const winAway = freq(awayGames.map((g) => g.gf > g.ga));
  const formSupport = pick === 'CASA' ? winHome : pick === 'FORA' ? winAway : null;
  const score = Math.round(100 * weighted([
    { w: 30, v: Math.min(1, (prob - 0.34) / 0.3) },
    { w: 20, v: formSupport },
    { w: 15, v: Math.min(1, (prob - entries[1][1]) / 0.25) },
    { w: 20, v: sampleFactor(m) },
    { w: 15, v: consistency(pick === 'FORA' ? m.history.awayGF : m.history.homeGF) },
  ]));
  const pros: string[] = [`Cenário mais provável pelo modelo: ${pick} (${pctTxt(prob)}).`];
  if (formSupport !== null) pros.push(`Vitórias recentes do lado indicado: ${pctTxt(formSupport)}.`);
  const consList: string[] = [];
  if (prob - entries[1][1] < 0.08) consList.push('Diferença pequena para o segundo cenário — jogo equilibrado.');
  if (pick === 'EMPATE') consList.push('Empate é o cenário de maior variância.');
  return {
    scenario: SCENARIOS[3], match: m,
    headline: pick,
    score, rating: ratingOf(score), quality: qualityOf(m.sample, m.history),
    stats: [
      { label: 'Casa', value: pctTxt(o.home) },
      { label: 'Empate', value: pctTxt(o.draw) },
      { label: 'Fora', value: pctTxt(o.away) },
      { label: 'Odd justa', value: prob > 0 ? (1 / prob).toFixed(2) : '—' },
    ],
    pros, cons: consList,
    why: `Maior separação entre os três resultados possíveis entre os jogos analisados, sustentada por ${m.sample.home}/${m.sample.away} jogos reais.`,
    recent: recentRows(m),
  };
}

function buildUpsetCard(m: AnalyzedMatch): ScenarioCard | null {
  const { homeGames, awayGames } = pairHistory(m);
  if (homeGames.length < 3 || awayGames.length < 3) return null;
  const o = m.read.outcome;
  const favIsHome = o.home >= o.away;
  const favProb = favIsHome ? o.home : o.away;
  const undProb = favIsHome ? o.away : o.home;
  if (favProb - undProb < 0.12) return null; // sem favorito claro = não é zebra
  const fav = favIsHome ? m.homeTeam : m.awayTeam;
  const und = favIsHome ? m.awayTeam : m.homeTeam;
  const favGames = favIsHome ? homeGames : awayGames;
  const undGames = favIsHome ? awayGames : homeGames;

  const favConceded = favGames.reduce((a, g) => a + g.ga, 0) / favGames.length;
  const favNotWon = freq(favGames.map((g) => g.gf <= g.ga)) ?? 0;
  const undScored = freq(undGames.map((g) => g.gf > 0)) ?? 0;
  const undNotLost = freq(undGames.map((g) => g.gf >= g.ga)) ?? 0;

  const vulnerability = weighted([
    { w: 1, v: Math.min(1, favConceded / 1.8) },
    { w: 1, v: favNotWon },
  ]);
  const strength = weighted([{ w: 1, v: undScored }, { w: 1, v: undNotLost }]);
  const score = Math.round(100 * weighted([
    { w: 30, v: vulnerability },
    { w: 25, v: strength },
    { w: 20, v: Math.min(1, undProb / 0.35) },
    { w: 25, v: sampleFactor(m) },
  ]));
  if (vulnerability < 0.35 || strength < 0.35) return null;
  const pros = [
    `${fav} sofreu ${favConceded.toFixed(2)} gols por jogo nos últimos ${favGames.length}.`,
    `${fav} não venceu ${pctTxt(favNotWon)} dos jogos recentes.`,
    `${und} marcou em ${pctTxt(undScored)} e ficou invicto em ${pctTxt(undNotLost)} dos jogos.`,
  ];
  const consList = [
    `Modelo ainda favorece ${fav} (${pctTxt(favProb)} contra ${pctTxt(undProb)}).`,
  ];
  if (Math.min(m.sample.home, m.sample.away) < 5) consList.push('Amostra abaixo de 5 jogos por equipe.');
  return {
    scenario: SCENARIOS[4], match: m,
    headline: `Indicador de surpresa: ${und}`,
    score, rating: ratingOf(score), quality: qualityOf(m.sample, m.history),
    stats: [
      { label: 'Favorito', value: fav },
      { label: 'Prob. favorito', value: pctTxt(favProb) },
      { label: 'Prob. zebra', value: pctTxt(undProb) },
      { label: 'Odd justa (zebra)', value: undProb > 0 ? (1 / undProb).toFixed(2) : '—' },
    ],
    pros, cons: consList,
    why: 'Este cenário foi selecionado porque existem indicadores estatísticos de vulnerabilidade do favorito.',
    recent: recentRows(m),
  };
}

function recentRows(m: AnalyzedMatch) {
  const fmt = (gf: number[], ga: number[]) => {
    const n = Math.min(gf.length, ga.length);
    if (!n) return '—';
    return Array.from({ length: n }, (_, i) => `${gf[i]}-${ga[i]}`).join(' · ');
  };
  return [
    { label: m.homeTeam, values: fmt(m.history.homeGF, m.history.homeGA) },
    { label: m.awayTeam, values: fmt(m.history.awayGF, m.history.awayGA) },
  ];
}

/* ------------------------------------------------------------------ */
/* Seleção final                                                       */
/* ------------------------------------------------------------------ */

const BUILDERS: Record<ScenarioKey, (m: AnalyzedMatch) => ScenarioCard | null> = {
  correct_score: buildCorrectScoreCard,
  btts: buildBttsCard,
  goals25: buildGoals25Card,
  result: buildResultCard,
  upset: buildUpsetCard,
};

/** Score mínimo para um cenário ser publicado. */
const MIN_SCORE = 60;

export interface AnalyzerResult {
  cards: ScenarioCard[];
  missing: ScenarioMeta[];
  analyzedCount: number;
}

export function runBetAnalyzer(matches: AnalyzedMatch[]): AnalyzerResult {
  const pool = matches.filter(eligible);

  // Todos os candidatos por cenário
  const candidates = SCENARIOS.map((s) => ({
    scenario: s,
    list: pool
      .map((m) => BUILDERS[s.key](m))
      .filter((c): c is ScenarioCard => !!c && c.score >= MIN_SCORE)
      .sort((a, b) => b.score - a.score),
  }));

  // Atribuição gulosa: cenário com menos opções escolhe primeiro (evita bloqueios)
  const order = [...candidates].sort((a, b) => a.list.length - b.list.length);
  const used = new Set<string>();
  const chosen = new Map<ScenarioKey, ScenarioCard>();
  for (const c of order) {
    const pick = c.list.find((card) => !used.has(card.match.id));
    if (pick) { used.add(pick.match.id); chosen.set(c.scenario.key, pick); }
  }

  const cards = SCENARIOS.map((s) => chosen.get(s.key)).filter((c): c is ScenarioCard => !!c);
  const missing = SCENARIOS.filter((s) => !chosen.has(s.key));
  return { cards, missing, analyzedCount: pool.length };
}

export { extractLambdas };
