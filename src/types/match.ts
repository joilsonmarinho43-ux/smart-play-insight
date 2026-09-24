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
  /** Neutral Bayesian goal prior; never presented as observed league data. */
  leagueAvg?: number | null;
  /** Provenance for the quantitative inputs. */
  source?: string | null;
  historicalSample?: number | null;
  dataQuality?: 'VALID' | 'PARTIAL' | 'INSUFFICIENT';
}

export interface SampleSize {
  homeGames: number;
  awayGames: number;
  homeWithStats: number;
  awayWithStats: number;
}

export interface MatchData {
  id: string;
  /** Native fixture identifier used by the active provider for detail/stat endpoints. */
  providerFixtureId?: string | number;
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
  historicalStats?: Record<'home' | 'away', { stats: Record<string, number | null | undefined>; sample: Record<string, number>; sources: Record<string, string[]> }>;
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
  /** Provider freshness; STALE is display-only and cannot qualify for a signal. */
  dataFreshness?: 'FRESH' | 'STALE';
  dataStaleAgeMs?: number;
  dataSource?: string;
  liveStats?: {
    dangerousAttacks: [number | null, number | null];
    corners: [number | null, number | null];
    possession: [number | null, number | null];
    pressureIndex: [number | null, number | null];
  };
}

export type RiskProfile = 'conservador' | 'moderado' | 'agressivo';

export type ProbabilitySource =
  | 'MODEL_ESTIMATE'
  | 'HEURISTIC'
  | 'DERIVED'
  | 'MARKET_IMPLIED'
  | 'UNKNOWN';

/** CALIBRATED is reserved for empirical calibration; MODEL_VALIDATED is structural validation only. */
export type CalibrationStatus = 'UNCALIBRATED' | 'MODEL_VALIDATED' | 'CALIBRATED';

export interface MarketAnalysis {
  market: string;
  probability: number;
  risk: string;
  category: string;
  odd?: number;
  /** Fair odd derived only from the model probability; not a market quote. */
  fairOdd?: number;
  /** Provenance of the price; SIGNAL requires an explicitly observed market odd. */
  oddSource?: 'OBSERVED' | 'UNKNOWN';
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
