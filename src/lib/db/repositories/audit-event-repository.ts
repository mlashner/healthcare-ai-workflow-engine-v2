import { desc, eq } from "drizzle-orm";

import {
  auditEventSchema,
  createAuditEventSchema,
  type AuditEvent,
  type CreateAuditEvent,
} from "@/lib/domain";

import type { Database } from "../client";
import { auditEvents } from "../schema";
import { newEntityId } from "./ids";

export function createAuditEventRepository(db: Database) {
  return {
    async create(input: CreateAuditEvent): Promise<AuditEvent> {
      const data = createAuditEventSchema.parse(input);
      const [row] = await db
        .insert(auditEvents)
        .values({
          id: data.id ?? newEntityId(),
          agentRunId: data.agentRunId,
          toolName: data.toolName,
          outcome: data.outcome,
          code: data.code,
          message: data.message,
          actorId: data.actorId,
          agentName: data.agentName,
          patientScope: data.patientScope,
          input: data.input ?? null,
          details: data.details ?? null,
        })
        .returning();

      return auditEventSchema.parse(row);
    },

    async listByAgentRunId(agentRunId: string): Promise<AuditEvent[]> {
      const rows = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.agentRunId, agentRunId))
        .orderBy(desc(auditEvents.createdAt));

      return rows.map((row) => auditEventSchema.parse(row));
    },
  };
}
