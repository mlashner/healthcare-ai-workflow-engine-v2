import { desc, eq } from "drizzle-orm";

import {
  clinicalDocumentSchema,
  createClinicalDocumentSchema,
  type ClinicalDocument,
  type CreateClinicalDocument,
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
  };
}
