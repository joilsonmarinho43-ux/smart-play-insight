// Superbet Connect — Schemas Zod compartilhados (Fase 2)
// Tipos validados retornados pelo parser. Edge function importa via cópia
// (Deno não compartilha src/), mantemos a fonte aqui para o front e
// duplicamos no edge function _shared.
import { z } from "zod";

export const TeamPair = z.object({
  home: z.string().min(1).optional(),
  away: z.string().min(1).optional(),
  league: z.string().optional(),
  minute: z.number().int().min(0).max(130).optional(),
  score: z.string().regex(/^\d{1,2}\s*[-x:]\s*\d{1,2}$/).optional(),
});

export const OddItem = z.object({
  market: z.string(),     // "Over 2.5", "1X2", "BTTS", "Escanteios 9.5"
  selection: z.string(),  // "Over", "Home", "Sim", "Yes", "1"
  price: z.number().min(1.01).max(1000),
});

export const StatsBlock = z.record(
  z.string(),
  z.object({ home: z.number().optional(), away: z.number().optional() })
);

export const H2HEntry = z.object({
  date: z.string().optional(),
  competition: z.string().optional(),
  home: z.string().optional(),
  away: z.string().optional(),
  score: z.string().optional(),
  result: z.enum(["H", "D", "A"]).optional(),
});

export const LineupBlock = z.object({
  home: z.array(z.string()).optional(),
  away: z.array(z.string()).optional(),
  homeFormation: z.string().optional(),
  awayFormation: z.string().optional(),
});

export const IncidentItem = z.object({
  minute: z.number().int().min(0).max(130).optional(),
  type: z.enum(["goal", "yellow", "red", "sub", "var", "penalty", "other"]).optional(),
  team: z.enum(["home", "away"]).optional(),
  detail: z.string().optional(),
});

export const ParsedCapture = z.object({
  kind: z.enum(["text", "url", "image", "mixed"]),
  match: TeamPair.optional(),
  odds: z.array(OddItem).optional(),
  stats: StatsBlock.optional(),
  h2h: z.array(H2HEntry).optional(),
  lineups: LineupBlock.optional(),
  incidents: z.array(IncidentItem).optional(),
  confidence: z.number().min(0).max(1),
  parserVersion: z.string(),
  missingFields: z.array(z.string()),
  note: z.string().optional(),
});

export type ParsedCaptureT = z.infer<typeof ParsedCapture>;
export type OddItemT = z.infer<typeof OddItem>;
