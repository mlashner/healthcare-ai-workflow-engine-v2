import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "@/lib/db/client";
import { createRepositories } from "@/lib/db/repositories";
import { fictionalKnowledgeCorpus } from "@/retrieval/corpus";
import { formatCitationId } from "@/retrieval/citations";
import { FICTIONAL_KNOWLEDGE_DISCLAIMER } from "@/retrieval/disclaimer";
import { createLexicalEmbedder } from "@/retrieval/embedder";
import { ingestKnowledgeCorpus } from "@/retrieval/ingest";
import { createKnowledgeSearch } from "@/retrieval/search";

const db = getDb();
const repos = createRepositories(db);
const embedder = createLexicalEmbedder();
const search = createKnowledgeSearch({
  chunks: repos.documentChunks,
  embedder,
});

beforeAll(async () => {
  await ingestKnowledgeCorpus(fictionalKnowledgeCorpus, {
    documents: repos.clinicalDocuments,
    chunks: repos.documentChunks,
    embedder,
  });
});

afterAll(async () => {
  await closeDb();
});

describe("clinical knowledge retrieval", () => {
  it("ingests at least 20 fictional documents", () => {
    expect(fictionalKnowledgeCorpus.length).toBeGreaterThanOrEqual(20);
    expect(
      fictionalKnowledgeCorpus.every((document) =>
        document.content.includes(FICTIONAL_KNOWLEDGE_DISCLAIMER),
      ),
    ).toBe(true);
  });

  it("retrieves diabetes coordination evidence for a relevant query", async () => {
    const results = await search.search({
      query: "diabetes follow-up after an unplanned clinic visit",
      limit: 5,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.some((result) => result.documentId === "kb_diabetes_followup")).toBe(true);
    expect(results[0]?.similarityScore).toBeGreaterThan(0.28);
    expect(results[0]?.relevantText).toContain("DEMO ONLY");
    expect(results[0]?.citationId).toMatch(/^cite:kb_/);
  });

  it("returns no hits for an irrelevant query", async () => {
    const results = await search.search({
      query: "orbital mechanics of a spaceship thruster",
      minSimilarity: 0.35,
    });

    expect(results).toEqual([]);
  });

  it("filters by metadata source", async () => {
    const results = await search.search({
      query: "notify care team outreach approval",
      source: "policy",
      minSimilarity: 0.15,
      limit: 10,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((result) => result.source === "policy")).toBe(true);
    expect(results.some((result) => result.documentId === "kb_outreach_policy")).toBe(true);
  });

  it("filters by topic metadata", async () => {
    const results = await search.search({
      query: "dizziness and unsteady walking after a new medication",
      topic: "fall_risk",
      minSimilarity: 0.15,
      limit: 10,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((result) => result.documentId.startsWith("kb_fall_"))).toBe(true);
  });

  it("generates parseable citation identifiers for each chunk", async () => {
    const results = await search.search({
      query: "teach-back plain language patient message",
      topic: "patient_communication",
      minSimilarity: 0.15,
    });

    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.citationId).toBe(
        formatCitationId(result.documentId, Number(result.citationId.split(":").at(-1))),
      );
      expect(result.version).toBe("demo-1");
    }
  });
});
