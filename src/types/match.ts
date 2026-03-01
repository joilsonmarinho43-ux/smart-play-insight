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

export interface MatchData {
  id: string;
  time: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  homeLogo?: string;
  awayLogo?: string;
  metrics: MatchMetrics;
  predictions: {
    homeWin: string;
    draw: string;
    awayWin: string;
  };
}

export interface TicketSuggestion {
  type: 'goals' | 'corners' | 'cards' | 'combined';
  label: string;
  reasoning: string;
  confidence: 'alta' | 'média' | 'baixa';
}
