import { MatchData } from '@/types/match';
import { analyzeMarkets } from './matchAnalysis';

export function generatePreGameBingo(match: MatchData) {
  const markets = analyzeMarkets(match);

  if (!markets || markets.length === 0) return null;

  // 🔥 FILTRO REAL (SEM QUEBRAR MODELO)
  const validMarkets = markets.filter((m) => {
    if (m.probability < 60) return false; // corte mínimo
    if (m.risk === 'Alto') return false;  // evita risco alto

    // 🎯 só mercados confiáveis
    if (
      m.category !== 'goals' &&
      m.category !== 'corners' &&
      m.category !== 'result'
    ) return false;

    return true;
  });

  if (validMarkets.length === 0) return null;

  // 🔥 ORDEM PROFISSIONAL
  const priority = [
    'Over 1.5 Gols',
    'Over 2.5 Gols',
    '1X',
    'X2',
    'Vitória'
  ];

  const sorted = validMarkets.sort((a, b) => {
    const pa = priority.findIndex(p => a.market.includes(p));
    const pb = priority.findIndex(p => b.market.includes(p));
    return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
  });

  const selected = sorted.slice(0, 3);

  return {
    markets: selected.map((m) => ({
      market: m.market,
      probability: Math.min(m.probability, 85), // 🔥 LIMITADOR FINAL
    })),
  };
                                  }
