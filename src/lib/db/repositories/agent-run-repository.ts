import { desc, eq } from "drizzle-orm";

import {
  agentRunSchema,
  createAgentRunSchema,
  updateAgentRunSchema,
  type AgentRun,
  type CreateAgentRun,
  type UpdateAgentRun,
} from "@/lib/domain";

import type { Database } from "../client";
import { agentRuns } from "../schema";
import { newEntityId } from "./ids";

export function createAgentRunRepository(db: Database) {
  return {
    async create(input: CreateAgentRun): Promise<AgentRun> {
      const data = createAgentRunSchema.parse(input);
      const [row] = await db
        .insert(agentRuns)
        .values({
          id: data.id ?? newEntityId(),
          patientId: data.patientId,
          agentName: data.agentName,
          status: data.status,
          startedAt: data.startedAt,
          completedAt: data.completedAt ?? null,
        })
        .returning();

      return agentRunSchema.parse(row);
    },

    async getById(id: string): Promise<AgentRun | null> {
      const [row] = await db.select().from(agentRuns).where(eq(agentRuns.id, id)).limit(1);
      return row ? agentRunSchema.parse(row) : null;
    },

    async listRecent(limit = 20): Promise<AgentRun[]> {
      const rows = await db
        .select()
        .from(agentRuns)
        .orderBy(desc(agentRuns.startedAt))
        .limit(limit);

      return rows.map((row) => agentRunSchema.parse(row));
    },

    async listByPatientId(patientId: string): Promise<AgentRun[]> {
      const rows = await db
        .select()
        .from(agentRuns)
        .where(eq(agentRuns.patientId, patientId))
        .orderBy(desc(agentRuns.startedAt));

      return rows.map((row) => agentRunSchema.parse(row));
    },

    async update(id: string, input: UpdateAgentRun): Promise<AgentRun | null> {
      const data = updateAgentRunSchema.parse(input);
      const [row] = await db.update(agentRuns).set(data).where(eq(agentRuns.id, id)).returning();
      return row ? agentRunSchema.parse(row) : null;
    },
  };
}
