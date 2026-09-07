import { asc, eq } from "drizzle-orm";

import {
  agentEventSchema,
  createAgentEventSchema,
  type AgentEvent,
  type CreateAgentEvent,
} from "@/lib/domain";

import type { Database } from "../client";
import { agentEvents } from "../schema";
import { newEntityId } from "./ids";

export function createAgentEventRepository(db: Database) {
  return {
    async create(input: CreateAgentEvent): Promise<AgentEvent> {
      const data = createAgentEventSchema.parse(input);
      const [row] = await db
        .insert(agentEvents)
        .values({
          id: data.id ?? newEntityId(),
          agentRunId: data.agentRunId,
          eventType: data.eventType,
          toolName: data.toolName ?? null,
          input: data.input ?? null,
          output: data.output ?? null,
          timestamp: data.timestamp,
        })
        .returning();

      return agentEventSchema.parse(row);
    },

    async getById(id: string): Promise<AgentEvent | null> {
      const [row] = await db.select().from(agentEvents).where(eq(agentEvents.id, id)).limit(1);
      return row ? agentEventSchema.parse(row) : null;
    },

    async listByAgentRunId(agentRunId: string): Promise<AgentEvent[]> {
      const rows = await db
        .select()
        .from(agentEvents)
        .where(eq(agentEvents.agentRunId, agentRunId))
        .orderBy(asc(agentEvents.timestamp));

      return rows.map((row) => agentEventSchema.parse(row));
    },
  };
}
