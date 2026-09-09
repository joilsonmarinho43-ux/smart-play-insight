export interface MatchMetrics {
  possession: [number, number];
  xG: [number, number] | null;
  totalShots: [number, number];
  shotsOnTarget: [number, number];
  bigChances: [number, number];
  corners: [number, number];
  offsides: [number, number];
  fouls: [number, number];
  yellowCards: [number, number];
}

export interface ModelData {
  homeGoalsAvg: number | null;
  awayGoalsAvg: number | null;
  homeGoalsAgainstAvg?: number | null;
  awayGoalsAgainstAvg?: number | null;
  homeCornersAvg: number | null;
  awayCornersAvg: number | null;
  homeCardsAvg: number | null;
  awayCardsAvg: number | null;
  homeCornersVariance: number | null;
  awayCornersVariance: number | null;
  homeCardsVariance: number | null;
  awayCardsVariance: number | null;
}

export interface SampleSize {
  homeGames: number;
  awayGames: number;
  homeWithStats: number;
  awayWithStats: number;
}

export interface MatchData {
  id: string;
  time: string;
  /** Canonical fixture kickoff timestamp when available; time may remain display-formatted. */
  kickoff?: string | null;
  league: string;
  homeTeam: string;
  awayTeam: string;

  homeLogo?: string;
  awayLogo?: string;

  metrics?: MatchMetrics;
  modelData?: ModelData;
  sampleSize?: SampleSize;

  predictions?: {
    homeWin: string;
    draw: string;
    awayWin: string;
  };

  // LIVE
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

/**
 * Proveniência da probabilidade analítica.
 *
 * MODEL_ESTIMATE = estimativa de modelo (Poisson/xG/Bayes etc.),
 * HEURISTIC = regra/proxy operacional sem calibração estatística demonstrada,
 * DERIVED = transformação de outra probabilidade (ex.: complemento),
 * MARKET_IMPLIED = probabilidade implícita de preço/odd de mercado,
 * UNKNOWN = legado ou origem não informada.
 */
export type ProbabilitySource =
  | 'MODEL_ESTIMATE'
  | 'HEURISTIC'
  | 'DERIVED'
  | 'MARKET_IMPLIED'
  | 'UNKNOWN';

/** Estado de calibração empírica; não deve ser inferido apenas pela confiança. */
export type CalibrationStatus = 'UNCALIBRATED' | 'CALIBRATED';

export interface MarketAnalysis {
  market: string;
  probability: number;
  risk: string;
  category: string;
  odd?: number;
  probabilitySource?: ProbabilitySource;
  calibrationStatus?: CalibrationStatus;
}

export interface HomeAwayStats {
  goalsFor: number;
  goalsAgainst: number;
}

export interface LiveSideStats {
  dangerousAttacks: number;
  corners: number;
  possession: number;
  shotsOnGoal: number;
}
