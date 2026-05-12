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
  rmaVerdict?: RMAVerdict;
  rmaScore?: number;
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
// EV estimado (odd implícita com margem 8%)
// ═══════════════════════════════════════
function estimateEV(probability: number, market?: string): number {
  if (probability <= 0) return -1;
  const p = probability / 100;
  const margins: Record<string, number> = {
    'Over 0.5 Gols': 0.92, 'Over 1.5 Gols': 0.90, 'Over 2.5 Gols': 0.87,
    'Over 3.5 Gols': 0.85, 'Ambas Marcam': 0.88,
  };
  const margin = margins[market || ''] || 0.88;
  const marketOdd = Math.max(1 / (p * margin), 1.05);
  return Math.round((p * marketOdd - 1) * 100) / 100;
}

// ═══════════════════════════════════════
// Opportunity Score = prob*0.5 + ev*0.3 + pressure*0.2
// ═══════════════════════════════════════
function calculateOpportunityScore(probability: number, ev: number, pressure: number): number {
  const normProb = probability / 100;
  const normEV = Math.max(0, Math.min(1, (ev + 0.1) / 0.2));
  const normPressure = pressure / 100;
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
  addLog('info', `Scanner iniciado: ${matches.length} jogos para análise`);

  const now = Date.now();
  const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN', 'PST', 'CANC', 'ABD', 'AWD', 'WO']);
  const PRE_STATUSES = new Set(['NS', 'TBD']);

  for (const match of matches) {
    const isLive = !!match.isLive;

    // Filtro de status: ignorar jogos finalizados, cancelados ou já iniciados (não-live)
    const statusShort: string = (match as any).fixture?.status?.short || (match as any).status?.short || '';
    const fixtureDate = (match as any).fixture?.date ? new Date((match as any).fixture.date).getTime() : null;

    if (FINISHED_STATUSES.has(statusShort)) {
      addLog('info', `Jogo descartado (finalizado: ${statusShort})`, match.id);
      continue;
    }

    if (!isLive) {
      // Pré-jogo: deve estar agendado e ainda não ter começado
      if (statusShort && !PRE_STATUSES.has(statusShort)) {
        addLog('info', `Jogo descartado (status não pré-jogo: ${statusShort})`, match.id);
        continue;
      }
      if (fixtureDate && fixtureDate <= now) {
        addLog('info', `Jogo descartado (kickoff já passou)`, match.id);
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
      addLog('error', `Falha ao analisar mercados: ${e}`, match.id);
      continue;
    }

    // Validar mercados
    markets = markets.filter(validateMarket);
    if (markets.length === 0) {
      addLog('warn', 'Nenhum mercado válido encontrado', match.id);
      continue;
    }

    const pressure = isLive
      ? calculatePressure(lH, lA)
      : calculatePressure(hStats, aStats);

    const totalSoG = (lH.shotsOnGoal || hStats.shotsOnGoal || 0) + (lA.shotsOnGoal || aStats.shotsOnGoal || 0);
    const minute = match.minute || (match as any).fixture?.status?.elapsed || null;
    const hasGoalSignal = isLive && goalSignal(pressure, totalSoG, minute);
    const dataQuality = assessDataQuality(hStats, aStats, isLive);

    // Filter valid markets
    const targetMarkets = [
      'Over 0.5 Gols', 'Over 1.5 Gols', 'Over 2.5 Gols', 'Over 3.5 Gols',
      'Ambas Marcam',
      '1X (Casa ou Empate)', 'X2 (Empate ou Fora)',
      'Vitória Casa', 'Vitória Fora',
    ];

    for (const market of markets) {
      if (!targetMarkets.includes(market.market)) continue;

      const ev = estimateEV(market.probability, market.market);
      if (market.probability < 60 || ev <= 0) continue;

      const score = calculateOpportunityScore(market.probability, ev, pressure);

      const homeTeam = (match as any).teams?.home?.name || match.homeTeam || 'Casa';
      const awayTeam = (match as any).teams?.away?.name || match.awayTeam || 'Fora';

      opportunities.push({
        matchId: match.id,
        match: `${homeTeam} vs ${awayTeam}`,
        minute,
        league: (match as any).league?.name || match.league || '',
        opportunity: market.market,
        probability: market.probability,
        ev: Math.round(ev * 100) / 100,
        pressure: Math.round(pressure),
        score: Math.round(score * 100) / 100,
        signal: hasGoalSignal ? '🔥 GOL IMINENTE' : null,
        isLive,
        dataQuality,
        kickoff: (match as any).fixture?.date || null,
      });
    }

    // ═══ RMA VALIDATION (parallel layer) ═══
    if (isLive && minute && minute > 0) {
      const rmaInput = buildRMAInput(lH, lA, minute, pressure);
      const rmaResult = evaluateRMA(rmaInput);
      // Attach RMA verdict to all opportunities from this match
      for (const opp of opportunities) {
        if (opp.matchId === match.id && opp.rmaVerdict === undefined) {
          opp.rmaVerdict = rmaResult.verdict;
          opp.rmaScore = rmaResult.score;
        }
      }
    }

    // Standalone imminent goal
    if (hasGoalSignal) {
      const existingGoalOpp = opportunities.find(o => o.matchId === match.id && o.signal);
      if (!existingGoalOpp) {
        const homeTeam = (match as any).teams?.home?.name || match.homeTeam || 'Casa';
        const awayTeam = (match as any).teams?.away?.name || match.awayTeam || 'Fora';
        opportunities.push({
          matchId: match.id,
          match: `${homeTeam} vs ${awayTeam}`,
          minute,
          league: (match as any).league?.name || match.league || '',
          opportunity: 'Próximo Gol',
          probability: Math.min(85, 60 + Math.round(pressure * 0.25)),
          ev: 0.05,
          pressure: Math.round(pressure),
          score: 0.80,
          signal: '🔥 GOL IMINENTE',
          isLive: true,
          dataQuality: 'high',
        });
      }
    }
  }

  // Sort by score descending
  opportunities.sort((a, b) => b.score - a.score);

  // Deduplicate same market+match, max 10
  const seen = new Set<string>();
  const top: ScannerOpportunity[] = [];
  for (const opp of opportunities) {
    const key = `${opp.matchId}-${opp.opportunity}`;
    if (seen.has(key)) continue;
    seen.add(key);
    top.push(opp);
    if (top.length >= 10) break;
  }

  addLog('info', `Scanner finalizado: ${top.length} oportunidades encontradas de ${matches.length} jogos`);
  return top;
}
