import { describe, expect, it } from "vitest";

import { cosineSimilarity, createLexicalEmbedder } from "@/retrieval/embedder";

describe("lexical embedder", () => {
  const embedder = createLexicalEmbedder();

  it("places diabetes language closer than unrelated spaceflight language", () => {
    const query = embedder.embed("diabetes follow-up after unplanned visit");
    const relevant = embedder.embed(
      "Adults with type 2 diabetes need care-coordination follow-up within 14 days.",
    );
    const irrelevant = embedder.embed("orbital mechanics of a spaceship thruster");

    expect(cosineSimilarity(query, relevant)).toBeGreaterThan(cosineSimilarity(query, irrelevant));
    expect(cosineSimilarity(query, relevant)).toBeGreaterThan(0.35);
  });
});
