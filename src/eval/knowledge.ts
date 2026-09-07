import type { DocumentChunk } from "@/lib/domain";
import { chunkText } from "@/retrieval/chunk";
import { fictionalKnowledgeCorpus } from "@/retrieval/corpus";
import { formatCitationId } from "@/retrieval/citations";
import { cosineSimilarity, createLexicalEmbedder } from "@/retrieval/embedder";
import { createKnowledgeSearch, type KnowledgeHit, type KnowledgeSearch } from "@/retrieval/search";
import type { ChunkSearchHit } from "@/lib/db/repositories/document-chunk-repository";

const DISCLAIMER_PREFIX = "DEMO ONLY";

export type EvalKnowledgeIndex = {
  search: KnowledgeSearch;
  hitForDocument(documentId: string): KnowledgeHit | undefined;
};

export function createEvalKnowledgeIndex(): EvalKnowledgeIndex {
  const embedder = createLexicalEmbedder();
  const chunks: ChunkSearchHit[] = [];

  for (const document of fictionalKnowledgeCorpus) {
    chunkText(document.content).forEach((content, chunkIndex) => {
      chunks.push({
        chunk: {
          id: `chk_${document.id}_${chunkIndex}`,
          documentId: document.id,
          chunkIndex,
          citationId: formatCitationId(document.id, chunkIndex),
          content,
          embedding: embedder.embed(content),
          source: document.source,
          version: document.version,
          topics: document.topics,
          createdAt: new Date(0),
        } satisfies DocumentChunk,
        title: document.title,
        similarity: 0,
      });
    });
  }

  const search = createKnowledgeSearch({
    embedder,
    chunks: {
      async search(filters) {
        return chunks
          .filter((hit) => {
            if (filters.source && hit.chunk.source !== filters.source) {
              return false;
            }
            if (filters.version && hit.chunk.version !== filters.version) {
              return false;
            }
            if (filters.topic && !hit.chunk.topics.includes(filters.topic)) {
              return false;
            }
            return true;
          })
          .map((hit) => ({
            ...hit,
            similarity: cosineSimilarity(filters.embedding, hit.chunk.embedding),
          }))
          .filter((hit) => hit.similarity >= filters.minSimilarity)
          .sort((left, right) => right.similarity - left.similarity)
          .slice(0, filters.limit);
      },
    },
  });

  return {
    search,
    hitForDocument(documentId) {
      const preferred =
        chunks.find(
          (hit) => hit.chunk.documentId === documentId && !hit.chunk.content.startsWith(DISCLAIMER_PREFIX),
        ) ?? chunks.find((hit) => hit.chunk.documentId === documentId);
      if (!preferred) {
        return undefined;
      }
      return {
        documentId: preferred.chunk.documentId,
        title: preferred.title,
        relevantText: preferred.chunk.content,
        similarityScore: 1,
        source: preferred.chunk.source,
        version: preferred.chunk.version,
        citationId: preferred.chunk.citationId,
      };
    },
  };
}
