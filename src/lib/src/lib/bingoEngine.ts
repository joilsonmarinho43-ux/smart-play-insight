import { MatchData, MarketAnalysis } from '@/types/match';
import { analyzeMarkets } from './matchAnalysis';

export function generatePreGameBingo(match: MatchData) {
  const markets = analyzeMarkets(match);

  if (!markets || markets.length === 0) return null;

  // 🔥 FILTRO NÍVEL CASA DE APOSTA
  const validMarkets = markets.filter((m) => {
    // corta odds infladas
    if (m.probability > 85) return false;

    // corta odds fracas
    if (m.probability < 55) return false;

    // evita mercado lixo
    if (m.risk === 'Alto') return false;

    return true;
  });

  if (validMarkets.length === 0) return null;

  // 🔥 PRIORIDADE (igual trader profissional)
  const priorityOrder = [
    'Over 1.5 Gols',
    'Over 2.5 Gols',
    '1X',
    'X2',
    'Over 5.5 Escanteios',
    'Over 6.5 Escanteios',
  ];

  const sorted = validMarkets.sort((a, b) => {
    const pa = priorityOrder.indexOf(a.market);
    const pb = priorityOrder.indexOf(b.market);

    return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
  });

  // 🔥 LIMITA (EVITA POLUIÇÃO)
  const selected = sorted.slice(0, 3);

  return {
    over15: findProb(selected, 'Over 1.5 Gols'),
    over25: findProb(selected, 'Over 2.5 Gols'),
    btts: findBTTS(match), // calculo separado
    markets: selected,
  };
}

// ── BTTS REAL ─────────────────────────────────────
function findBTTS(match: MatchData): number {
  const metrics = match.metrics;
  if (!metrics) return 0;

  const shotsH = metrics.totalShots?.[0] || 0;
  const shotsA = metrics.totalShots?.[1] || 0;

  if (shotsH < 5 || shotsA < 5) return 40;

  return Math.min(75, 50 + (shotsH + shotsA));
}

// ── UTIL ─────────────────────────────────────────
function findProb(markets: MarketAnalysis[], name: string): number {
  const found = markets.find((m) => m.market === name);
  return found ? found.probability : 0;
  }
