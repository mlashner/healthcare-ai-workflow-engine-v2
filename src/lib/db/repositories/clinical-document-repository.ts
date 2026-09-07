import { desc, eq } from "drizzle-orm";

import {
  clinicalDocumentSchema,
  createClinicalDocumentSchema,
  updateClinicalDocumentSchema,
  type ClinicalDocument,
  type CreateClinicalDocument,
  type UpdateClinicalDocument,
} from "@/lib/domain";

import type { Database } from "../client";
import { clinicalDocuments } from "../schema";
import { newEntityId } from "./ids";

export function createClinicalDocumentRepository(db: Database) {
  return {
    async create(input: CreateClinicalDocument): Promise<ClinicalDocument> {
      const data = createClinicalDocumentSchema.parse(input);
      const [row] = await db
        .insert(clinicalDocuments)
        .values({
          id: data.id ?? newEntityId(),
          title: data.title,
          content: data.content,
          source: data.source,
          version: data.version,
          topics: data.topics,
        })
        .returning();

      return clinicalDocumentSchema.parse(row);
    },

    async getById(id: string): Promise<ClinicalDocument | null> {
      const [row] = await db
        .select()
        .from(clinicalDocuments)
        .where(eq(clinicalDocuments.id, id))
        .limit(1);

      return row ? clinicalDocumentSchema.parse(row) : null;
    },

    async list(): Promise<ClinicalDocument[]> {
      const rows = await db
        .select()
        .from(clinicalDocuments)
        .orderBy(desc(clinicalDocuments.createdAt));

      return rows.map((row) => clinicalDocumentSchema.parse(row));
    },

    async update(id: string, input: UpdateClinicalDocument): Promise<ClinicalDocument | null> {
      const data = updateClinicalDocumentSchema.parse(input);
      const [row] = await db
        .update(clinicalDocuments)
        .set(data)
        .where(eq(clinicalDocuments.id, id))
        .returning();

      return row ? clinicalDocumentSchema.parse(row) : null;
    },
  };
}
