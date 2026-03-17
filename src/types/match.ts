export interface MatchMetrics {
  possession: [number, number];
  xG: [number, number];
  totalShots: [number, number];
  shotsOnTarget: [number, number];
  bigChances: [number, number];
  corners: [number, number];
  offsides: [number, number];
  fouls: [number, number];
  yellowCards: [number, number];
}

export interface ModelData {
  homeGoalsAvg: number;
  awayGoalsAvg: number;
  homeCornersAvg: number;
  awayCornersAvg: number;
  homeCardsAvg: number;
  awayCardsAvg: number;
  homeCornersVariance: number;
  awayCornersVariance: number;
  homeCardsVariance: number;
  awayCardsVariance: number;
}

export interface SampleSize {
  homeGames: number;
  awayGames: number;
  homeWithStats: number;
  awayWithStats: number;
}

// Interface estendida para suportar Live sem quebrar Pré-jogo
export interface MatchData {
  id: string;
  time: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  homeLogo?: string;
  awayLogo?: string;
  metrics: MatchMetrics;
  modelData: ModelData;
  sampleSize?: SampleSize;
  predictions: {
    homeWin: string;
    draw: string;
    awayWin: string;
  };
  // Novos campos para funcionalidade LIVE
  isLive?: boolean;
  status?: string;
  minute?: number;
  liveScore?: {
    home: number;
    away: number;
  };
  liveStats?: {
    dangerousAttacks: [number, number];
    corners: [number, number];
    possession: [number, number];
    pressureIndex: [number, number];
  };
}

export type RiskProfile = 'conservador' | 'moderado' | 'agressivo';

export interface MarketAnalysis {
  market: string;
  category: 'goals' | 'corners' | 'cards' | 'result';
  probability: number;
  statisticalBasis: string;
  risk: 'Baixo' | 'Médio' | 'Alto';
}

export interface TicketSuggestion {
  type: 'goals' | 'corners' | 'cards' | 'combined';
  label: string;
  reasoning: string;
  confidence: 'alta' | 'média' | 'baixa';
}
