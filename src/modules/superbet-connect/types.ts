export type CaptureStatus = 'pending' | 'parsing' | 'parsed' | 'failed';

export type CaptureKind = 'text' | 'url' | 'image' | 'mixed';

export interface SuperbetCaptureRow {
  id: string;
  user_id: string;
  raw_text: string | null;
  raw_image_url: string | null;
  source_url: string | null;
  market_hint: string | null;
  parsed_json: Record<string, any> | null;
  status: CaptureStatus;
  parser_version: string | null;
  confidence: number | null;
  created_at: string;
  updated_at: string;
}

export interface ParsedCapturePayload {
  kind: CaptureKind;
  match?: { home?: string; away?: string; league?: string; minute?: number; score?: string };
  odds?: Array<{ market: string; selection: string; price: number }>;
  stats?: Record<string, { home?: number; away?: number }>;
  h2h?: Array<{ date?: string; result?: string }>;
  lineups?: { home?: string[]; away?: string[] };
  incidents?: Array<{ minute?: number; type?: string; team?: 'home' | 'away'; detail?: string }>;
  confidence: number; // 0..1
  parserVersion: string;
  missingFields: string[];
}
