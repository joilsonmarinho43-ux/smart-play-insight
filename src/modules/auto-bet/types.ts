export interface AutoPilotSignal {
  id: string;
  match_id: string | null;
  match_name: string;
  league: string | null;
  market: string;
  minute: number;
  confidence: number;
  odd: number | null;
  created_at: string;
  reason?: string | null;
}

export interface AutoPilotLog {
  id: string;
  ts: string;
  match_name: string;
  market: string;
  stake: number;
  odd: number | null;
  score: number;
  status: "opened" | "skipped" | "blocked";
  reason?: string;
}
