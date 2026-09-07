import type { ClinicalDocument, CreateClinicalDocument } from "@/lib/domain";

import { chunkText } from "./chunk";
import { formatCitationId } from "./citations";
import type { KnowledgeDocumentDraft } from "./corpus";
import { FICTIONAL_KNOWLEDGE_DISCLAIMER } from "./disclaimer";
import type { Embedder } from "./embedder";

export type DocumentWriter = {
  getById(id: string): Promise<ClinicalDocument | null>;
  create(input: CreateClinicalDocument): Promise<ClinicalDocument>;
  update(
    id: string,
    input: Pick<CreateClinicalDocument, "title" | "content" | "source" | "version" | "topics">,
  ): Promise<ClinicalDocument | null>;
};

export type ChunkWriter = {
  replaceForDocument(
    documentId: string,
    rows: Array<{
      id: string;
      documentId: string;
      chunkIndex: number;
      citationId: string;
      content: string;
      embedding: number[];
      source: ClinicalDocument["source"];
      version: string;
      topics: ClinicalDocument["topics"];
    }>,
  ): Promise<void>;
};

export async function ingestKnowledgeDocument(
  draft: KnowledgeDocumentDraft,
  deps: { documents: DocumentWriter; chunks: ChunkWriter; embedder: Embedder },
): Promise<ClinicalDocument> {
  const existing = await deps.documents.getById(draft.id);
  const saved = existing
    ? await deps.documents.update(draft.id, {
        title: draft.title,
        content: draft.content,
        source: draft.source,
        version: draft.version,
        topics: draft.topics,
      })
    : await deps.documents.create(draft);

  if (!saved) {
    throw new Error(`failed to persist knowledge document ${draft.id}`);
  }

  const chunks = chunkText(draft.content).map((content, chunkIndex) => {
    const citedText = content.includes("DEMO ONLY")
      ? content
      : `${FICTIONAL_KNOWLEDGE_DISCLAIMER} ${content}`;
    return {
      id: `${draft.id}_chunk_${chunkIndex}`,
      documentId: draft.id,
      chunkIndex,
      citationId: formatCitationId(draft.id, chunkIndex),
      content: citedText,
      embedding: deps.embedder.embed(`${draft.title}\n${citedText}`),
      source: draft.source,
      version: draft.version,
      topics: draft.topics,
    };
  });

  await deps.chunks.replaceForDocument(draft.id, chunks);
  return saved;
}

export async function ingestKnowledgeCorpus(
  drafts: KnowledgeDocumentDraft[],
  deps: { documents: DocumentWriter; chunks: ChunkWriter; embedder: Embedder },
): Promise<ClinicalDocument[]> {
  const saved: ClinicalDocument[] = [];
  for (const draft of drafts) {
    saved.push(await ingestKnowledgeDocument(draft, deps));
  }
  return saved;
}
