import { describe, expect, it } from "vitest";
import { getResearchGapFields } from "@/lib/researchContextClient";

describe("getResearchGapFields", () => {
  it("requests only the gaps in an incomplete context", () => {
    const fields = getResearchGapFields({
      injuries: { source: "unavailable" },
      lineups: { home: { confirmed: false }, away: { confirmed: true } },
      motivation: { haveStandings: false },
      fatigue: { available: false },
      odds: null,
    });

    expect(fields).toEqual([
      "INJURY",
      "SUSPENSION",
      "LINEUP",
      "FORM",
      "H2H",
      "MOTIVATION",
      "ODDS",
      "REFEREE",
      "WEATHER",
    ]);
  });

  it("does not request research when structured context is complete", () => {
    const fields = getResearchGapFields({
      injuries: { source: "provider_injuries" },
      lineups: { home: { confirmed: true }, away: { confirmed: true } },
      motivation: { haveStandings: true },
      fatigue: { available: true },
      odds: { home: 2, draw: 3, away: 4 },
      referee: { name: "Ref" },
      weather: { temperature: 25 },
    });

    expect(fields).toEqual([]);
  });

  it("never includes model probability as a research field", () => {
    expect(getResearchGapFields({ odds: null })).not.toContain("MODEL_PROBABILITY");
  });
});
