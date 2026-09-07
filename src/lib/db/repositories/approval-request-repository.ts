import { desc, eq } from "drizzle-orm";

import {
  approvalRequestSchema,
  createApprovalRequestSchema,
  updateApprovalRequestSchema,
  type ApprovalRequest,
  type CreateApprovalRequest,
  type UpdateApprovalRequest,
} from "@/lib/domain";

import type { Database } from "../client";
import { approvalRequests } from "../schema";
import { newEntityId } from "./ids";

export function createApprovalRequestRepository(db: Database) {
  return {
    async create(input: CreateApprovalRequest): Promise<ApprovalRequest> {
      const data = createApprovalRequestSchema.parse(input);
      const [row] = await db
        .insert(approvalRequests)
        .values({
          id: data.id ?? newEntityId(),
          agentRunId: data.agentRunId,
          action: data.action,
          status: data.status,
          requestedAt: data.requestedAt,
          reviewedAt: data.reviewedAt ?? null,
          reviewer: data.reviewer ?? null,
          reason: data.reason ?? null,
        })
        .returning();

      return approvalRequestSchema.parse(row);
    },

    async getById(id: string): Promise<ApprovalRequest | null> {
      const [row] = await db
        .select()
        .from(approvalRequests)
        .where(eq(approvalRequests.id, id))
        .limit(1);

      return row ? approvalRequestSchema.parse(row) : null;
    },

    async listByAgentRunId(agentRunId: string): Promise<ApprovalRequest[]> {
      const rows = await db
        .select()
        .from(approvalRequests)
        .where(eq(approvalRequests.agentRunId, agentRunId))
        .orderBy(desc(approvalRequests.requestedAt));

      return rows.map((row) => approvalRequestSchema.parse(row));
    },

    async update(id: string, input: UpdateApprovalRequest): Promise<ApprovalRequest | null> {
      const data = updateApprovalRequestSchema.parse(input);
      const [row] = await db
        .update(approvalRequests)
        .set(data)
        .where(eq(approvalRequests.id, id))
        .returning();

      return row ? approvalRequestSchema.parse(row) : null;
    },
  };
}
