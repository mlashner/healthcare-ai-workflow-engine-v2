import { and, cosineDistance, desc, eq, sql } from "drizzle-orm";

import {
  documentChunkSchema,
  type ClinicalDocumentSource,
  type DocumentChunk,
  type KnowledgeTopic,
} from "@/lib/domain";

import type { Database } from "../client";
import { clinicalDocuments, documentChunks } from "../schema";

export type ChunkSearchFilters = {
  embedding: number[];
  limit: number;
  minSimilarity: number;
  source?: ClinicalDocumentSource;
  version?: string;
  topic?: KnowledgeTopic;
};

export type ChunkSearchHit = {
  chunk: DocumentChunk;
  title: string;
  similarity: number;
};

export function createDocumentChunkRepository(db: Database) {
  return {
    async replaceForDocument(
      documentId: string,
      rows: Array<Omit<DocumentChunk, "createdAt"> & { createdAt?: Date }>,
    ): Promise<void> {
      await db.delete(documentChunks).where(eq(documentChunks.documentId, documentId));
      if (rows.length === 0) {
        return;
      }
      // Chunk ids are derived from the document, so re-ingesting the same
      // corpus concurrently must converge rather than collide.
      await db
        .insert(documentChunks)
        .values(rows)
        .onConflictDoUpdate({
          target: documentChunks.id,
          set: {
            chunkIndex: sql`excluded.chunk_index`,
            citationId: sql`excluded.citation_id`,
            content: sql`excluded.content`,
            embedding: sql`excluded.embedding`,
            source: sql`excluded.source`,
            version: sql`excluded.version`,
            topics: sql`excluded.topics`,
          },
        });
    },

    async getByCitationId(citationId: string): Promise<{ chunk: DocumentChunk; title: string } | null> {
      const [row] = await db
        .select({ chunk: documentChunks, title: clinicalDocuments.title })
        .from(documentChunks)
        .innerJoin(clinicalDocuments, eq(documentChunks.documentId, clinicalDocuments.id))
        .where(eq(documentChunks.citationId, citationId))
        .limit(1);

      return row ? { chunk: documentChunkSchema.parse(row.chunk), title: row.title } : null;
    },

    async listByDocumentId(documentId: string): Promise<DocumentChunk[]> {
      const rows = await db
        .select()
        .from(documentChunks)
        .where(eq(documentChunks.documentId, documentId));
      return rows.map((row) => documentChunkSchema.parse(row));
    },

    async search(filters: ChunkSearchFilters): Promise<ChunkSearchHit[]> {
      const similarity = sql<number>`1 - (${cosineDistance(documentChunks.embedding, filters.embedding)})`;
      const conditions = [sql`${similarity} >= ${filters.minSimilarity}`];

      if (filters.source) {
        conditions.push(eq(documentChunks.source, filters.source));
      }
      if (filters.version) {
        conditions.push(eq(documentChunks.version, filters.version));
      }
      if (filters.topic) {
        conditions.push(sql`${documentChunks.topics} @> ${JSON.stringify([filters.topic])}::jsonb`);
      }

      const rows = await db
        .select({
          chunk: documentChunks,
          title: clinicalDocuments.title,
          similarity,
        })
        .from(documentChunks)
        .innerJoin(clinicalDocuments, eq(documentChunks.documentId, clinicalDocuments.id))
        .where(and(...conditions))
        .orderBy(desc(similarity))
        .limit(filters.limit);

      return rows.map((row) => ({
        chunk: documentChunkSchema.parse(row.chunk),
        title: row.title,
        similarity: Number(row.similarity),
      }));
    },
  };
}
