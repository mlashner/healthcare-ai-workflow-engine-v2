import { desc, eq } from "drizzle-orm";

import {
  careTaskSchema,
  createCareTaskSchema,
  updateCareTaskSchema,
  type CareTask,
  type CreateCareTask,
  type UpdateCareTask,
} from "@/lib/domain";

import type { Database } from "../client";
import { careTasks } from "../schema";
import { newEntityId } from "./ids";

export function createCareTaskRepository(db: Database) {
  return {
    async create(input: CreateCareTask): Promise<CareTask> {
      const data = createCareTaskSchema.parse(input);
      const [row] = await db
        .insert(careTasks)
        .values({
          id: data.id ?? newEntityId(),
          patientId: data.patientId,
          type: data.type,
          description: data.description,
          priority: data.priority,
          status: data.status,
          assignedTo: data.assignedTo ?? null,
        })
        .returning();

      return careTaskSchema.parse(row);
    },

    async getById(id: string): Promise<CareTask | null> {
      const [row] = await db.select().from(careTasks).where(eq(careTasks.id, id)).limit(1);
      return row ? careTaskSchema.parse(row) : null;
    },

    async listByAssignedTo(providerId: string): Promise<CareTask[]> {
      const rows = await db
        .select()
        .from(careTasks)
        .where(eq(careTasks.assignedTo, providerId))
        .orderBy(desc(careTasks.createdAt));

      return rows.map((row) => careTaskSchema.parse(row));
    },

    async listByPatientId(patientId: string): Promise<CareTask[]> {
      const rows = await db
        .select()
        .from(careTasks)
        .where(eq(careTasks.patientId, patientId))
        .orderBy(desc(careTasks.createdAt));

      return rows.map((row) => careTaskSchema.parse(row));
    },

    async update(id: string, input: UpdateCareTask): Promise<CareTask | null> {
      const data = updateCareTaskSchema.parse(input);
      const [row] = await db.update(careTasks).set(data).where(eq(careTasks.id, id)).returning();
      return row ? careTaskSchema.parse(row) : null;
    },
  };
}
