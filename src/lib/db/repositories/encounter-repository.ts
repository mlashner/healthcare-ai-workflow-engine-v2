import { desc, eq } from "drizzle-orm";

import {
  createEncounterSchema,
  encounterSchema,
  type CreateEncounter,
  type Encounter,
} from "@/lib/domain";

import type { Database } from "../client";
import { encounters } from "../schema";
import { newEntityId } from "./ids";

export function createEncounterRepository(db: Database) {
  return {
    async create(input: CreateEncounter): Promise<Encounter> {
      const data = createEncounterSchema.parse(input);
      const [row] = await db
        .insert(encounters)
        .values({
          id: data.id ?? newEntityId(),
          patientId: data.patientId,
          providerId: data.providerId,
          transcript: data.transcript,
          occurredAt: data.occurredAt,
        })
        .returning();

      return encounterSchema.parse(row);
    },

    async getById(id: string): Promise<Encounter | null> {
      const [row] = await db.select().from(encounters).where(eq(encounters.id, id)).limit(1);
      return row ? encounterSchema.parse(row) : null;
    },

    async listByProviderId(providerId: string): Promise<Encounter[]> {
      const rows = await db
        .select()
        .from(encounters)
        .where(eq(encounters.providerId, providerId))
        .orderBy(desc(encounters.occurredAt));

      return rows.map((row) => encounterSchema.parse(row));
    },

    async listByPatientId(patientId: string): Promise<Encounter[]> {
      const rows = await db
        .select()
        .from(encounters)
        .where(eq(encounters.patientId, patientId))
        .orderBy(desc(encounters.occurredAt));

      return rows.map((row) => encounterSchema.parse(row));
    },
  };
}
