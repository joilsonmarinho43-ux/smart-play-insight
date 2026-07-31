import { MatchData, MarketAnalysis } from '@/types/match';
import { analyzeMarkets, isValidBet } from '@/lib/matchAnalysis';
import { evaluateRMA, buildRMAInput, type RMAVerdict, type RMAResult } from '@/lib/rmaEngine';

export interface ScannerOpportunity {
  matchId: string;
  match: string;
  minute: number | null;
  league: string;
  opportunity: string;
  probability: number;
  ev: number;
  pressure: number;
  score: number;
  signal: string | null;
  isLive: boolean;
  dataQuality: 'high' | 'medium' | 'low';
  kickoff?: string | null;
  timeLabel?: string;

  rmaVerdict?: RMAVerdict;
  rmaScore?: number;

  /** Justificativa com números reais do confronto */
  reason?: string;
  /** Índice de assertividade 0-100 (prob ajustada por qualidade de dados) */
  confidence?: number;
  /** Odd justa do modelo */
  fairOdd?: number;
  /** Odd típica praticada no mercado para a linha */
  marketOdd?: number;
  /** Alternativas analisadas e descartadas neste jogo */
  alternatives?: { market: string; probability: number; ev: number }[];
}

export interface ScannerLog {
  type: 'info' | 'warn' | 'error';
  message: string;
  matchId?: string;
  timestamp: number;
}

const scannerLogs: ScannerLog[] = [];

function addLog(type: ScannerLog['type'], message: string, matchId?: string) {
  scannerLogs.push({ type, message, matchId, timestamp: Date.now() });
  if (scannerLogs.length > 100) scannerLogs.shift();
}

export function getScannerLogs(): ScannerLog[] {
  return [...scannerLogs];
}

// ═══════════════════════════════════════
// Pressão com fallback para DA=0
// ═══════════════════════════════════════
function safeDangerousAttacks(stats: { dangerousAttacks?: number; totalShots?: number; corners?: number; shotsOnGoal?: number }): number {
  if (stats.dangerousAttacks && stats.dangerousAttacks > 0) return stats.dangerousAttacks;
  return ((stats.totalShots || stats.shotsOnGoal || 0) * 1.5) + ((stats.corners || 0) * 2);
}

function calculatePressure(homeStats: any, awayStats: any): number {
  const hDA = safeDangerousAttacks(homeStats || {});
  const aDA = safeDangerousAttacks(awayStats || {});
  const hCorners = homeStats?.corners || 0;
  const aCorners = awayStats?.corners || 0;
  const hSoG = homeStats?.shotsOnGoal || 0;
  const aSoG = awayStats?.shotsOnGoal || 0;

  const raw = (hDA + aDA) * 3 + (hCorners + aCorners) * 5 + (hSoG + aSoG) * 10;
  return Math.min(100, Math.max(0, raw / 5)); // normalised 0-100
}

// ═══════════════════════════════════════
// Detector de Gol Iminente
// ═══════════════════════════════════════
function goalSignal(pressure: number, shotsOnGoal: number, minute: number | null | undefined): boolean {
  return pressure > 70 && shotsOnGoal >= 4 && (minute || 0) >= 20;
}

// ═══════════════════════════════════════
// EV estimado — compara a probabilidade do modelo com a
// probabilidade implícita típica de mercado (baseline) + margem da casa.
// Antes o cálculo derivava a odd da própria probabilidade, o que
// resultava num EV constante (bug) para todos os jogos.
// ═══════════════════════════════════════
const MARKET_BASELINE: Record<string, number> = {
  'Over 0.5 Gols': 0.93,
  'Over 1.5 Gols': 0.76,
  'Over 2.5 Gols': 0.52,
  'Over 3.5 Gols': 0.28,
  'Ambas Marcam': 0.52,
  '1X (Casa ou Empate)': 0.80,
  'X2 (Empate ou Fora)': 0.74,

  'Vitória Casa': 0.45,
  'Vitória Fora': 0.30,
  'Próximo Gol': 0.50,

  'Under 2.5 Gols': 0.48,
  'Gol no 1° Tempo': 0.57,
  'Gol no 2° Tempo': 0.62,
  'Over 5.5 Cantos': 0.80,
  'Over 7.5 Cantos': 0.60,
  'Over 9.5 Cantos': 0.38,
};

const BOOKMAKER_MARGIN = 0.06;

function marketOddFor(market?: string): number {
  const baseline = MARKET_BASELINE[market || ''] ?? 0.55;
  return Math.max((1 / baseline) * (1 - BOOKMAKER_MARGIN), 1.01);
}

function estimateEV(probability: number, market?: string): number {
  if (!Number.isFinite(probability) || probability <= 0) return -1;
  const p = Math.min(0.99, probability / 100);
  // Odd praticada = odd justa do baseline reduzida pela margem da casa
  const ev = p * marketOddFor(market) - 1;
  return Math.round(ev * 1000) / 1000;
}

// ═══════════════════════════════════════
// Opportunity Score
// LIVE:  prob*0.5 + ev*0.3 + pressão*0.2
// PRÉ:   prob*0.65 + ev*0.35 (sem pressão ao vivo)
// ═══════════════════════════════════════
function calculateOpportunityScore(probability: number, ev: number, pressure: number, isLive: boolean): number {
  const normProb = Math.max(0, Math.min(1, probability / 100));
  const normEV = Math.max(0, Math.min(1, (ev + 0.05) / 0.35));
  if (!isLive) return normProb * 0.65 + normEV * 0.35;
  const normPressure = Math.max(0, Math.min(1, pressure / 100));
  return normProb * 0.5 + normEV * 0.3 + normPressure * 0.2;
}


// ═══════════════════════════════════════
// Filtro Inteligente LIVE
// ═══════════════════════════════════════
function passesLiveSmartFilter(match: MatchData, homeStats: any, awayStats: any): boolean {
  const minute = match.minute || (match as any).fixture?.status?.elapsed || 0;
  
  // Ignorar jogos sem estatísticas
  if (!homeStats && !awayStats) {
    addLog('warn', 'Sem estatísticas disponíveis', match.id);
    return false;
  }

  const h = homeStats || {};
  const a = awayStats || {};

  // Regra: até 15 minutos do 1° tempo — alta seletividade
  if (minute <= 15) {
    const totalSoG = (h.shotsOnGoal || 0) + (a.shotsOnGoal || 0);
    const totalCorners = (h.corners || 0) + (a.corners || 0);
    
    // Mínimo 3 chutes no alvo total
    if (totalSoG < 3) {
      addLog('info', `Filtrado: SoG insuficiente (${totalSoG} < 3) no min ${minute}`, match.id);
      return false;
    }
    
    // Escanteios entre 2 e 3 no total
    if (totalCorners < 2 || totalCorners > 3) {
      addLog('info', `Filtrado: Escanteios fora do range (${totalCorners}) no min ${minute}`, match.id);
      return false;
    }
    
    return true;
  }

  // Após 15 min: filtro mais permissivo
  const totalSoG = (h.shotsOnGoal || 0) + (a.shotsOnGoal || 0);
  const totalDA = safeDangerousAttacks(h) + safeDangerousAttacks(a);
  
  // Mínimo de atividade ofensiva
  if (totalSoG < 2 && totalDA < 5) {
    addLog('info', `Filtrado: Baixa atividade ofensiva no min ${minute}`, match.id);
    return false;
  }

  return true;
}

// ═══════════════════════════════════════
// Qualidade dos dados
// ═══════════════════════════════════════
function assessDataQuality(homeStats: any, awayStats: any, isLive: boolean): 'high' | 'medium' | 'low' {
  if (!isLive) {
    const h = homeStats || {};
    const hasGF = (h.goalsFor || 0) > 0 || (h.goalsAgainst || 0) > 0;
    const hasGames = (h.gamesCount || 0) >= 3;
    if (hasGF && hasGames) return 'high';
    if (hasGF || hasGames) return 'medium';
    return 'low';
  }
  
  const h = homeStats || {};
  const a = awayStats || {};
  const hasDA = (h.dangerousAttacks || 0) > 0 || (a.dangerousAttacks || 0) > 0;
  const hasSoG = (h.shotsOnGoal || 0) > 0 || (a.shotsOnGoal || 0) > 0;
  const hasPoss = (h.possession || 0) > 0;
  
  if (hasDA && hasSoG && hasPoss) return 'high';
  if (hasSoG || hasDA) return 'medium';
  return 'low';
}

// ═══════════════════════════════════════
// Validação de mercados
// ═══════════════════════════════════════
function validateMarket(market: MarketAnalysis): boolean {
  if (!market.market || market.market.trim() === '') return false;
  if (market.probability < 0 || market.probability > 100) return false;
  if (isNaN(market.probability)) return false;
  return true;
}

// ═══════════════════════════════════════
// Scanner Principal
// ═══════════════════════════════════════
export function scanMatches(matches: MatchData[]): ScannerOpportunity[] {
  const opportunities: ScannerOpportunity[] = [];
  // Reinicia os logs a cada varredura (antes acumulavam entre renders)
  scannerLogs.length = 0;
  addLog('info', `Scanner iniciado: ${matches.length} jogos para análise`);

  const now = Date.now();
  const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN', 'PST', 'CANC', 'ABD', 'AWD', 'WO']);
  const PRE_STATUSES = new Set(['NS', 'TBD']);

  for (const match of matches) {
    const isLive = !!match.isLive;

    const homeTeam = (match as any).teams?.home?.name || match.homeTeam || 'Casa';
    const awayTeam = (match as any).teams?.away?.name || match.awayTeam || 'Fora';
    // ID estável: evita colapsar jogos distintos sem id na deduplicação
    const matchId = String(match.id ?? `${homeTeam}-${awayTeam}`);

    // Filtro de status: ignorar jogos finalizados, cancelados ou já iniciados (não-live)
    const statusShort: string = (match as any).fixture?.status?.short || (match as any).status?.short || '';
    // Data/hora do jogo: as fontes usam campos diferentes (fixture.date, date,
    // utcDate, kickoff ou o próprio `time` em ISO)
    const dateCandidates = [
      (match as any).fixture?.date,
      (match as any).kickoff,
      (match as any).date,
      (match as any).utcDate,
      (match as any).startTime,
      match.time,
    ];
    let rawDate: string | null = null;
    let fixtureDate: number | null = null;
    for (const c of dateCandidates) {
      if (!c) continue;
      const t = new Date(c).getTime();
      if (Number.isFinite(t)) { rawDate = new Date(t).toISOString(); fixtureDate = t; break; }
    }
    // Rótulo simples (ex.: "20:30") quando não há data completa
    const timeLabel: string | undefined =
      typeof match.time === 'string' && /^\d{1,2}:\d{2}$/.test(match.time.trim()) ? match.time.trim() : undefined;


    if (FINISHED_STATUSES.has(statusShort)) {
      addLog('info', `Jogo descartado (finalizado: ${statusShort})`, matchId);
      continue;
    }

    if (!isLive) {
      // Pré-jogo: deve estar agendado e ainda não ter começado
      if (statusShort && !PRE_STATUSES.has(statusShort)) {
        addLog('info', `Jogo descartado (status não pré-jogo: ${statusShort})`, matchId);
        continue;
      }
      if (fixtureDate && fixtureDate <= now) {
        addLog('info', `Jogo descartado (kickoff já passou)`, matchId);
        continue;
      }
    }

    // Live stats
    const lH = (match as any).stats?.home || {};
    const lA = (match as any).stats?.away || {};
    const hStats = (match as any).homeStats || lH;
    const aStats = (match as any).awayStats || lA;

    // Filtro Inteligente LIVE
    if (isLive && !passesLiveSmartFilter(match, lH.shotsOnGoal !== undefined ? lH : null, lA.shotsOnGoal !== undefined ? lA : null)) {
      continue;
    }

    let markets: MarketAnalysis[];
    try {
      markets = analyzeMarkets(match);
    } catch (e) {
      addLog('error', `Falha ao analisar mercados: ${e}`, matchId);
      continue;
    }

    // Validar mercados
    markets = markets.filter(validateMarket);
    if (markets.length === 0) {
      addLog('warn', 'Nenhum mercado válido encontrado', matchId);
      continue;
    }

    // Pressão só faz sentido ao vivo — em pré-jogo usar médias de temporada
    // inflava o índice para 100 e distorcia o score.
    const pressure = isLive ? calculatePressure(lH, lA) : 0;

    const totalSoG = (lH.shotsOnGoal || hStats.shotsOnGoal || 0) + (lA.shotsOnGoal || aStats.shotsOnGoal || 0);
    const rawMinute = match.minute ?? (match as any).fixture?.status?.elapsed ?? null;
    const minute = isLive && Number.isFinite(Number(rawMinute)) ? Number(rawMinute) : null;
    const hasGoalSignal = isLive && goalSignal(pressure, totalSoG, minute);
    const dataQuality = assessDataQuality(hStats, aStats, isLive);

    // Filter valid markets
    const targetMarkets = [
      'Over 0.5 Gols', 'Over 1.5 Gols', 'Over 2.5 Gols', 'Over 3.5 Gols',
      'Ambas Marcam',
      '1X (Casa ou Empate)', 'X2 (Empate ou Fora)',
      'Vitória Casa', 'Vitória Fora',
    ];

    const matchOpportunities: ScannerOpportunity[] = [];

    const DC_MARKETS = new Set(['1X (Casa ou Empate)', 'X2 (Empate ou Fora)']);
    let dcCount = 0;

    for (const market of markets) {
      if (!targetMarkets.includes(market.market)) continue;

      const isDC = DC_MARKETS.has(market.market);
      // Dupla chance é naturalmente alta: exige mais e entra no máximo 1 por jogo
      if (isDC) {
        if (dcCount >= 1) continue;
        if (market.probability < 72) continue;
      }

      const ev = estimateEV(market.probability, market.market);
      const minEV = isDC ? 0.04 : 0;
      if (market.probability < 60 || ev <= minEV) continue;
      if (isDC) dcCount++;

      const score = calculateOpportunityScore(market.probability, ev, pressure, isLive);


      matchOpportunities.push({
        matchId,
        match: `${homeTeam} vs ${awayTeam}`,
        minute,
        league: (match as any).league?.name || match.league || '',
        opportunity: market.market,
        probability: Math.round(market.probability),
        ev: Math.round(ev * 100) / 100,
        pressure: Math.round(pressure),
        score: Math.round(score * 100) / 100,
        signal: hasGoalSignal ? '🔥 GOL IMINENTE' : null,
        isLive,
        dataQuality,
        kickoff: rawDate,
        timeLabel,
      });
    }

    // Standalone imminent goal
    if (hasGoalSignal && !matchOpportunities.some(o => o.opportunity === 'Próximo Gol')) {
      const prob = Math.min(85, 60 + Math.round(pressure * 0.25));
      const ev = estimateEV(prob, 'Próximo Gol');
      matchOpportunities.push({
        matchId,
        match: `${homeTeam} vs ${awayTeam}`,
        minute,
        league: (match as any).league?.name || match.league || '',
        opportunity: 'Próximo Gol',
        probability: prob,
        ev: Math.round(ev * 100) / 100,
        pressure: Math.round(pressure),
        score: Math.round(calculateOpportunityScore(prob, ev, pressure, true) * 100) / 100,
        signal: '🔥 GOL IMINENTE',
        isLive: true,
        dataQuality,
        kickoff: rawDate,
        timeLabel,
      });
    }

    // ═══ RMA VALIDATION (parallel layer) — apenas nas oportunidades deste jogo ═══
    if (isLive && minute && minute > 0 && matchOpportunities.length > 0) {
      try {
        const rmaResult = evaluateRMA(buildRMAInput(lH, lA, minute, pressure));
        for (const opp of matchOpportunities) {
          opp.rmaVerdict = rmaResult.verdict;
          opp.rmaScore = rmaResult.score;
        }
      } catch (e) {
        addLog('warn', `RMA indisponível: ${e}`, matchId);
      }
    }

    opportunities.push(...matchOpportunities);
  }


  // Sort by score descending
  opportunities.sort((a, b) => b.score - a.score);

  // Deduplicate same market+match, com diversidade:
  // no máx. 2 entradas por jogo e no máx. 3 duplas chances no top 10
  const seen = new Set<string>();
  const perMatch = new Map<string, number>();
  const DC = new Set(['1X (Casa ou Empate)', 'X2 (Empate ou Fora)']);
  let dcTotal = 0;
  const top: ScannerOpportunity[] = [];
  for (const opp of opportunities) {
    const key = `${opp.matchId}-${opp.opportunity}`;
    if (seen.has(key)) continue;
    if ((perMatch.get(opp.matchId) || 0) >= 2) continue;
    if (DC.has(opp.opportunity) && dcTotal >= 3) continue;
    seen.add(key);
    perMatch.set(opp.matchId, (perMatch.get(opp.matchId) || 0) + 1);
    if (DC.has(opp.opportunity)) dcTotal++;
    top.push(opp);
    if (top.length >= 10) break;
  }


  addLog('info', `Scanner finalizado: ${top.length} oportunidades encontradas de ${matches.length} jogos`);
  return top;
}
