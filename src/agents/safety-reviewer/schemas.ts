import { z } from "zod";

import type { BoundRunSession } from "@/runs/session";
import { proposedRecommendationSchema } from "@/safety/proposal";
import type { RetrievedSnippet } from "@/safety/review";

export {
  proposedRecommendationSchema,
  safetyReviewerResultSchema,
} from "@/safety/proposal";
export type {
  ProposedRecommendation,
  SafetyReviewerDecision,
  SafetyReviewerResult,
} from "@/safety/proposal";

export const safetyReviewerInputSchema = z
  .object({
    recommendation: proposedRecommendationSchema,
    retrievedSnippets: z
      .array(
        z
          .object({
            citationId: z.string().min(1).max(120),
            text: z.string().min(1).max(4000),
          })
          .strict(),
      )
      .max(40)
      .default([]),
    sourceRunId: z.string().min(1).max(64).optional(),
    agentRunId: z.string().min(1).max(64).optional(),
  })
  .strict();

export type SafetyReviewerRunInput = {
  session: BoundRunSession;
  recommendation: z.input<typeof proposedRecommendationSchema>;
  retrievedSnippets?: readonly RetrievedSnippet[];
  sourceRunId?: string;
  agentRunId?: string;
};

export type SafetyReviewerParsedInput = z.output<typeof safetyReviewerInputSchema>;
