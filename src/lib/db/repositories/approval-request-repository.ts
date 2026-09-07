import { and, desc, eq } from "drizzle-orm";

import {
  approvalRequestSchema,
  createApprovalRequestSchema,
  updateApprovalRequestSchema,
  type ApprovalRequest,
  type ApprovalStatus,
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
      const parsed = updateApprovalRequestSchema.parse(input);
      const data = Object.fromEntries(
        Object.entries(parsed).filter(([, value]) => value !== undefined),
      );
      if (Object.keys(data).length === 0) {
        const [current] = await db
          .select()
          .from(approvalRequests)
          .where(eq(approvalRequests.id, id))
          .limit(1);
        return current ? approvalRequestSchema.parse(current) : null;
      }

      const [row] = await db
        .update(approvalRequests)
        .set(data)
        .where(eq(approvalRequests.id, id))
        .returning();

      return row ? approvalRequestSchema.parse(row) : null;
    },

    /**
     * Compare-and-set: apply the update only when the row is still in
     * `expectedStatus`. Zero rows returned means another request won the race.
     */
    async updateIfStatus(
      id: string,
      expectedStatus: ApprovalStatus,
      input: UpdateApprovalRequest,
    ): Promise<ApprovalRequest | null> {
      const parsed = updateApprovalRequestSchema.parse(input);
      const data = Object.fromEntries(
        Object.entries(parsed).filter(([, value]) => value !== undefined),
      );
      if (Object.keys(data).length === 0) {
        const [current] = await db
          .select()
          .from(approvalRequests)
          .where(and(eq(approvalRequests.id, id), eq(approvalRequests.status, expectedStatus)))
          .limit(1);
        return current ? approvalRequestSchema.parse(current) : null;
      }

      const [row] = await db
        .update(approvalRequests)
        .set(data)
        .where(and(eq(approvalRequests.id, id), eq(approvalRequests.status, expectedStatus)))
        .returning();

      return row ? approvalRequestSchema.parse(row) : null;
    },
  };
}
