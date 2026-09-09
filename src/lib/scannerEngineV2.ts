import { MatchData, MarketAnalysis } from '@/types/match';
import { analyzeMarkets } from '@/lib/matchAnalysis';
import { calculateMarketAnalyticalValue } from '@/lib/analyticalValue';
import { evaluateRMA, buildRMAInput, type RMAVerdict } from '@/lib/rmaEngine';

/**
 * Scanner V2 — analytical only.
 *
 * IMPORTANT: EV is available only when MarketAnalysis.odd is a real observed
 * market price. No baseline odd, bookmaker margin or synthetic price is used.
 * Missing odds never become zero EV and never authorize a signal.
 */
export interface ScannerOpportunityV2 {
  matchId: string;
  match: string;
  minute: number | null;
  league: string;
  opportunity: string;
  probability: number;
  ev: number | null;
  pressure: number;
  score: number;
  signal: string | null;
  isLive: boolean;
  dataQuality: 'high' | 'medium' | 'low';
  kickoff?: string | null;
  timeLabel?: string;
  rmaVerdict?: RMAVerdict;
  rmaScore?: number;
  reason?: string;
  confidence?: number;
  fairOdd?: number;
  marketOdd?: number | null;
  alternatives?: { market: string; probability: number; ev: number | null }[];
}

export interface ScannerLogV2 {
  type: 'info' | 'warn' | 'error';
  message: string;
  matchId?: string;
  timestamp: number;
}

const logs: ScannerLogV2[] = [];
const TARGET_MARKETS = new Set([
  'Over 0.5 Gols', 'Over 1.5 Gols', 'Over 2.5 Gols', 'Over 3.5 Gols',
  'Under 2.5 Gols', 'Ambas Marcam', 'Gol no 1° Tempo', 'Gol no 2° Tempo',
  'Over 5.5 Cantos', 'Over 7.5 Cantos', 'Over 9.5 Cantos',
  '1X (Casa ou Empate)', 'X2 (Empate ou Fora)', 'Vitória Casa', 'Vitória Fora',
]);
const DC_MARKETS = new Set(['1X (Casa ou Empate)', 'X2 (Empate ou Fora)']);

function log(type: ScannerLogV2['type'], message: string, matchId?: string) {
  logs.push({ type, message, matchId, timestamp: Date.now() });
  if (logs.length > 100) logs.shift();
}

export function getScannerV2Logs(): ScannerLogV2[] {
  return [...logs];
}

function finite(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function pressureOf(home: any, away: any): number {
  const h = home || {};
  const a = away || {};
  const da = finite(h.dangerousAttacks) + finite(a.dangerousAttacks);
  const shots = finite(h.shotsOnGoal) + finite(a.shotsOnGoal);
  const corners = finite(h.corners) + finite(a.corners);
  return Math.min(100, Math.max(0, (da * 3 + corners * 5 + shots * 10) / 5));
}

function dataQualityOf(match: MatchData, live: boolean): 'high' | 'medium' | 'low' {
  if (!live) {
    const n = Math.min(finite(match.sampleSize?.homeGames), finite(match.sampleSize?.awayGames));
    return n >= 5 ? 'high' : n >= 3 ? 'medium' : 'low';
  }
  const metrics = match.metrics;
  if (!metrics) return 'low';
  const hasPossession = metrics.possession.some(v => finite(v) > 0);
  const hasShots = metrics.shotsOnTarget.some(v => finite(v) > 0);
  const hasCorners = metrics.corners.some(v => finite(v) > 0);
  if (hasPossession && hasShots && hasCorners) return 'high';
  if (hasShots || hasCorners) return 'medium';
  return 'low';
}

function confidenceOf(probability: number, quality: 'high' | 'medium' | 'low', sample: number, dc: boolean): number {
  let value = probability;
  if (quality === 'medium') value -= 6;
  if (quality === 'low') value -= 15;
  if (sample < 3) value -= 10;
  if (sample === 0) value -= 12;
  if (dc) value -= 8;
  return Math.max(0, Math.min(97, Math.round(value)));
}

function validMarket(market: MarketAnalysis): boolean {
  return TARGET_MARKETS.has(market.market)
    && Number.isFinite(market.probability)
    && market.probability >= 0
    && market.probability <= 100;
}

function marketReason(match: MatchData, market: MarketAnalysis, live: boolean, pressure: number): string {
  const sample = `${finite(match.sampleSize?.homeGames)}+${finite(match.sampleSize?.awayGames)} jogos`;
  if (live) {
    const minute = finite(match.minute, 0);
    return `LIVE ${minute}' • pressão ${Math.round(pressure)} • análise baseada nos eventos/estatísticas disponíveis. Probabilidade ${Math.round(market.probability)}%.`;
  }
  const md = match.modelData;
  const expected = md
    ? ((finite(md.homeGoalsAvg) + finite(md.awayGoalsAgainstAvg) + finite(md.awayGoalsAvg) + finite(md.homeGoalsAgainstAvg)) / 2)
    : null;
  return expected != null && expected > 0
    ? `Modelo pré-jogo com amostra ${sample} • expectativa combinada aproximada de ${expected.toFixed(2)} gols. Probabilidade ${Math.round(market.probability)}%.`
    : `Modelo pré-jogo com amostra ${sample}. Probabilidade ${Math.round(market.probability)}%.`;
}

export function scanMatchesV2(matches: MatchData[]): ScannerOpportunityV2[] {
  logs.length = 0;
  const opportunities: ScannerOpportunityV2[] = [];
  const now = Date.now();

  for (const match of matches) {
    const live = Boolean(match.isLive);
    const id = String(match.id);
    const home = match.homeTeam || 'Casa';
    const away = match.awayTeam || 'Fora';
    const fixtureDate = match.time ? new Date(match.time).getTime() : NaN;

    if (!live && Number.isFinite(fixtureDate) && fixtureDate <= now) {
      log('info', 'Jogo pré-jogo descartado porque o horário já passou', id);
      continue;
    }

    const rawHome = (match as any).stats?.home || (match as any).homeStats || {};
    const rawAway = (match as any).stats?.away || (match as any).awayStats || {};
    const pressure = live ? pressureOf(rawHome, rawAway) : 0;
    const quality = dataQualityOf(match, live);
    const sample = Math.min(finite(match.sampleSize?.homeGames), finite(match.sampleSize?.awayGames));

    let markets: MarketAnalysis[];
    try {
      markets = analyzeMarkets(match).filter(validMarket);
    } catch (error) {
      log('error', `Falha na análise: ${String(error)}`, id);
      continue;
    }

    const candidates: ScannerOpportunityV2[] = [];
    for (const market of markets) {
      const value = calculateMarketAnalyticalValue(market);
      const confidence = confidenceOf(market.probability, quality, sample, DC_MARKETS.has(market.market));

      // EV is informative only. Without a real odd, it is unavailable and
      // never used as a synthetic filter.
      const score = live
        ? (confidence / 100) * 0.85 + Math.min(1, pressure / 100) * 0.15
        : confidence / 100;

      candidates.push({
        matchId: id,
        match: `${home} vs ${away}`,
        minute: live ? finite(match.minute, 0) : null,
        league: match.league || '',
        opportunity: market.market,
        probability: Math.round(market.probability),
        ev: value.available ? value.ev : null,
        pressure: Math.round(pressure),
        score: Math.round(score * 100) / 100,
        signal: null,
        isLive: live,
        dataQuality: quality,
        kickoff: match.time || null,
        reason: marketReason(match, market, live, pressure),
        confidence,
        fairOdd: value.fairOdd,
        marketOdd: value.marketOdd,
      });
    }

    if (candidates.length === 0) {
      log('info', 'Nenhum mercado analítico elegível', id);
      continue;
    }

    candidates.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
    const best = candidates[0];
    best.alternatives = candidates.slice(1, 4).map(item => ({
      market: item.opportunity,
      probability: item.probability,
      ev: item.ev,
    }));

    if (live && best.minute != null && best.minute > 0) {
      try {
        const rma = evaluateRMA(buildRMAInput(rawHome, rawAway, best.minute, pressure));
        best.rmaVerdict = rma.verdict;
        best.rmaScore = rma.score;
      } catch (error) {
        log('warn', `RMA indisponível: ${String(error)}`, id);
      }
    }

    opportunities.push(best);
  }

  opportunities.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  return opportunities.slice(0, 10);
}
