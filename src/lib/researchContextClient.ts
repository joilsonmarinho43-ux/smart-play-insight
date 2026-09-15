import { supabase } from "@/integrations/supabase/client";
import type { ResearchEvidence, ResearchEvidenceType } from "@/lib/researchEvidence";

export interface ResearchContextRequest {
  id: number | string;
  homeTeam: string;
  awayTeam: string;
  league?: string | null;
  kickoff?: string | null;
  fields?: ResearchEvidenceType[];
}

export interface ResearchContextResult {
  ok: boolean;
  status?: string;
  evidence: ResearchEvidence[];
  provider?: string;
  generatedAt?: string;
  cached?: boolean;
}

const ALL_GAP_FIELDS: ResearchEvidenceType[] = [
  "INJURY",
  "SUSPENSION",
  "LINEUP",
  "FORM",
  "H2H",
  "MOTIVATION",
  "REFEREE",
  "WEATHER",
  "ODDS",
];

export function getResearchGapFields(context: any): ResearchEvidenceType[] {
  const fields = new Set<ResearchEvidenceType>();
  const injuriesMissing = context?.injuries?.source === "unavailable" || !context?.injuries;
  const lineupsMissing = !context?.lineups?.home?.confirmed || !context?.lineups?.away?.confirmed;
  const motivationMissing = !context?.motivation?.haveStandings;
  const fatigueMissing = context?.fatigue?.available !== true;
  const oddsMissing = !context?.odds;

  if (injuriesMissing) {
    fields.add("INJURY");
    fields.add("SUSPENSION");
  }
  if (lineupsMissing) fields.add("LINEUP");
  if (motivationMissing) fields.add("MOTIVATION");
  if (fatigueMissing) {
    fields.add("FORM");
    fields.add("H2H");
  }
  if (oddsMissing) fields.add("ODDS");
  if (!context?.referee) fields.add("REFEREE");
  if (!context?.weather) fields.add("WEATHER");

  return ALL_GAP_FIELDS.filter((field) => fields.has(field));
}

export async function fetchResearchContext(request: ResearchContextRequest): Promise<ResearchContextResult> {
  const fields = request.fields?.length ? request.fields : ALL_GAP_FIELDS;
  try {
    const { data, error } = await supabase.functions.invoke("research-context", {
      body: {
        match: {
          id: request.id,
          homeTeam: request.homeTeam,
          awayTeam: request.awayTeam,
          league: request.league ?? null,
          kickoff: request.kickoff ?? null,
        },
        fields,
      },
    });
    if (error || !data || typeof data !== "object") {
      return { ok: false, status: "RESEARCH_CLIENT_ERROR", evidence: [] };
    }
    return {
      ok: data.ok !== false,
      status: typeof data.status === "string" ? data.status : undefined,
      evidence: Array.isArray(data.evidence) ? data.evidence : [],
      provider: typeof data.provider === "string" ? data.provider : undefined,
      generatedAt: typeof data.generatedAt === "string" ? data.generatedAt : undefined,
      cached: data.cached === true,
    };
  } catch {
    return { ok: false, status: "RESEARCH_CLIENT_ERROR", evidence: [] };
  }
}
