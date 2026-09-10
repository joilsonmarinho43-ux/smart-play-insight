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
  awayCardsVariance: null | number;
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
    probabilitySource?: ProbabilitySource;
    calibrationStatus?: CalibrationStatus;
  };
  isLive?: boolean;
  status?: string;
  minute?: number;
  liveScore?: { home: number; away: number };
  liveStats?: {
    dangerousAttacks: [number, number];
    corners: [number, number];
    possession: [number, number];
    pressureIndex: [number, number];
  };
}

export type RiskProfile = 'conservador' | 'moderado' | 'agressivo';

export type ProbabilitySource =
  | 'MODEL_ESTIMATE'
  | 'HEURISTIC'
  | 'DERIVED'
  | 'MARKET_IMPLIED'
  | 'UNKNOWN';

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

export interface HomeAwayStats { goalsFor: number; goalsAgainst: number; }

export interface LiveSideStats {
  dangerousAttacks: number;
  corners: number;
  possession: number;
  shotsOnGoal: number;
}
