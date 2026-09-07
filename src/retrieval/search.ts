import type { ChunkSearchHit } from "@/lib/db/repositories/document-chunk-repository";
import type { SearchClinicalKnowledgeInput, SearchClinicalKnowledgeOutput } from "@/tools/schemas";

import type { Embedder } from "./embedder";

export type KnowledgeHit = SearchClinicalKnowledgeOutput["results"][number];

export type KnowledgeSearch = {
  search(input: SearchClinicalKnowledgeInput): Promise<KnowledgeHit[]>;
};

export type ChunkSearcher = {
  search(filters: {
    embedding: number[];
    limit: number;
    minSimilarity: number;
    source?: SearchClinicalKnowledgeInput["source"];
    version?: string;
    topic?: SearchClinicalKnowledgeInput["topic"];
  }): Promise<ChunkSearchHit[]>;
};

export const DEFAULT_SEARCH_LIMIT = 5;
export const DEFAULT_MIN_SIMILARITY = 0.28;

export function createKnowledgeSearch(deps: {
  chunks: ChunkSearcher;
  embedder: Embedder;
}): KnowledgeSearch {
  return {
    async search(input) {
      const hits = await deps.chunks.search({
        embedding: deps.embedder.embed(input.query),
        limit: input.limit ?? DEFAULT_SEARCH_LIMIT,
        minSimilarity: input.minSimilarity ?? DEFAULT_MIN_SIMILARITY,
        source: input.source,
        version: input.version,
        topic: input.topic,
      });

      return hits.map(toKnowledgeHit);
    },
  };
}

export function toKnowledgeHit(hit: ChunkSearchHit): KnowledgeHit {
  return {
    documentId: hit.chunk.documentId,
    title: hit.title,
    relevantText: hit.chunk.content,
    similarityScore: roundScore(hit.similarity),
    source: hit.chunk.source,
    version: hit.chunk.version,
    citationId: hit.chunk.citationId,
  };
}

function roundScore(value: number): number {
  return Math.round(value * 1000) / 1000;
}
