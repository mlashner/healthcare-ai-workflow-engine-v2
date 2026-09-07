import { describe, expect, it } from "vitest";

import { chunkText } from "@/retrieval/chunk";
import { FICTIONAL_KNOWLEDGE_DISCLAIMER } from "@/retrieval/disclaimer";

describe("chunkText", () => {
  it("keeps short paragraphs intact and preserves the fictional disclaimer", () => {
    const chunks = chunkText(
      `${FICTIONAL_KNOWLEDGE_DISCLAIMER}\n\nShort fictional paragraph about diabetes follow-up.`,
    );

    expect(chunks[0]).toContain("DEMO ONLY");
    expect(chunks.some((chunk) => chunk.includes("diabetes follow-up"))).toBe(true);
  });

  it("splits a long paragraph into overlapping windows", () => {
    const sentence = "Fictional sentence about hypertension home blood pressure logging.";
    const chunks = chunkText(Array.from({ length: 12 }, () => sentence).join(" "), {
      maxChars: 120,
      overlap: 20,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 140)).toBe(true);
  });
});
