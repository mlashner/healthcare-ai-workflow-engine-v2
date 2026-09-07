import { z } from "zod";

import { citationIdSchema } from "@/lib/domain";

export const safetyReviewerDecisions = ["approved", "rejected", "needs_revision"] as const;
export type SafetyReviewerDecision = (typeof safetyReviewerDecisions)[number];

export const proposedClaimSchema = z
  .object({
    text: z.string().min(1).max(2000),
    citationIds: z.array(citationIdSchema).max(20),
  })
  .strict();

export const proposedActionForReviewSchema = z
  .object({
    type: z.string().min(1).max(100),
    summary: z.string().min(1).max(1000),
    rationale: z.string().min(1).max(2000),
    citationIds: z.array(citationIdSchema).max(20),
    executedInRun: z.boolean().optional(),
  })
  .strict();

export const proposedRecommendationSchema = z
  .object({
    summary: z.string().min(1).max(4000),
    reasoning: z.string().max(8000).optional(),
    claims: z.array(proposedClaimSchema).max(30),
    proposedActions: z.array(proposedActionForReviewSchema).max(20),
    requiresHumanReview: z.boolean().optional(),
    uncertainty: z
      .object({
        isUncertain: z.boolean(),
        reasons: z.array(z.string().min(1).max(500)).max(20),
      })
      .strict()
      .optional(),
  })
  .strict();

export const safetyReviewerResultSchema = z
  .object({
    decision: z.enum(safetyReviewerDecisions),
    reasons: z.array(z.string().min(1).max(500)).max(40),
    policyViolations: z.array(z.string().min(1).max(100)).max(40),
    unsupportedClaims: z.array(z.string().min(1).max(2000)).max(40),
    requiredApprovals: z.array(z.string().min(1).max(100)).max(20),
    evidenceIssues: z.array(z.string().min(1).max(200)).max(40),
  })
  .strict();

export type ProposedClaim = z.output<typeof proposedClaimSchema>;
export type ProposedActionForReview = z.output<typeof proposedActionForReviewSchema>;
export type ProposedRecommendation = z.output<typeof proposedRecommendationSchema>;
export type SafetyReviewerResult = z.output<typeof safetyReviewerResultSchema>;
