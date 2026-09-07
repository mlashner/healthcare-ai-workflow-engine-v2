import { desc, eq } from "drizzle-orm";

import {
  createPatientSchema,
  patientSchema,
  updatePatientSchema,
  type CreatePatient,
  type Patient,
  type UpdatePatient,
} from "@/lib/domain";

import type { Database } from "../client";
import { patients } from "../schema";
import { newEntityId } from "./ids";

export function createPatientRepository(db: Database) {
  return {
    async create(input: CreatePatient): Promise<Patient> {
      const data = createPatientSchema.parse(input);
      const [row] = await db
        .insert(patients)
        .values({
          id: data.id ?? newEntityId(),
          name: data.name,
          dateOfBirth: data.dateOfBirth,
          conditions: data.conditions,
          medications: data.medications,
        })
        .returning();

      return patientSchema.parse(row);
    },

    async getById(id: string): Promise<Patient | null> {
      const [row] = await db.select().from(patients).where(eq(patients.id, id)).limit(1);
      return row ? patientSchema.parse(row) : null;
    },

    async list(): Promise<Patient[]> {
      const rows = await db.select().from(patients).orderBy(desc(patients.createdAt));
      return rows.map((row) => patientSchema.parse(row));
    },

    async update(id: string, input: UpdatePatient): Promise<Patient | null> {
      const data = updatePatientSchema.parse(input);
      const [row] = await db
        .update(patients)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(patients.id, id))
        .returning();

      return row ? patientSchema.parse(row) : null;
    },
  };
}
