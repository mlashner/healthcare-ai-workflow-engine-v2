import { describe, expect, it } from "vitest";

import { formatCitationId, parseCitationId } from "@/retrieval/citations";

describe("citation identifiers", () => {
  it("formats and parses a stable citation id", () => {
    const citationId = formatCitationId("kb_diabetes_followup", 0);

    expect(citationId).toBe("cite:kb_diabetes_followup:0");
    expect(parseCitationId(citationId)).toEqual({
      documentId: "kb_diabetes_followup",
      chunkIndex: 0,
    });
  });

  it("rejects malformed citation ids", () => {
    expect(parseCitationId("kb_diabetes_followup")).toBeNull();
    expect(parseCitationId("cite:bad id:0")).toBeNull();
  });
});
