import { z } from "zod";

import { actorRoles, citationIdSchema, entityIdSchema, timestampSchema } from "@/lib/domain";

export const urgencyLevels = ["none", "low", "medium", "high", "urgent"] as const;
export const evidenceKinds = ["retrieved", "inferred"] as const;
export const proposedActionTypes = [
  "create_care_task",
  "draft_patient_message",
  "request_human_approval",
  "observe_only",
] as const;

export const evidenceItemSchema = z
  .object({
    kind: z.enum(evidenceKinds),
    text: z.string().min(1).max(2000),
    citationId: citationIdSchema.optional(),
    toolName: z.string().min(1).max(100).optional(),
  })
  .strict();

export const identifiedConcernSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().min(1).max(2000),
    urgency: z.enum(urgencyLevels),
    citationIds: z.array(citationIdSchema).max(20),
  })
  .strict();

export const proposedActionSchema = z
  .object({
    type: z.enum(proposedActionTypes),
    summary: z.string().min(1).max(1000),
    rationale: z.string().min(1).max(2000),
    citationIds: z.array(citationIdSchema).max(20),
    executedInRun: z.boolean(),
  })
  .strict();

export const uncertaintySchema = z
  .object({
    isUncertain: z.boolean(),
    reasons: z.array(z.string().min(1).max(500)).max(20),
  })
  .strict();

export const careCoordinatorResultSchema = z
  .object({
    summary: z.string().min(1).max(4000),
    identifiedConcerns: z.array(identifiedConcernSchema).max(20),
    urgency: z.enum(urgencyLevels),
    reasoning: z.string().min(1).max(8000),
    evidence: z.array(evidenceItemSchema).max(30),
    proposedActions: z.array(proposedActionSchema).max(20),
    requiresHumanReview: z.boolean(),
    confidence: z.number().min(0).max(1),
    uncertainty: uncertaintySchema,
  })
  .strict();

export const thinkStepSchema = z
  .object({
    type: z.literal("think"),
    thought: z.string().min(1).max(4000),
  })
  .strict();

export const toolCallStepSchema = z
  .object({
    type: z.literal("tool_call"),
    toolName: z.string().min(1).max(100),
    arguments: z.record(z.string(), z.unknown()),
  })
  .strict();

export const finishStepSchema = z
  .object({
    type: z.literal("finish"),
    result: careCoordinatorResultSchema,
  })
  .strict();

export const careCoordinatorStepSchema = z.discriminatedUnion("type", [
  thinkStepSchema,
  toolCallStepSchema,
  finishStepSchema,
]);

export const careCoordinatorRunInputSchema = z
  .object({
    actor: z
      .object({
        id: entityIdSchema,
        role: z.enum(actorRoles),
      })
      .strict(),
    patientId: entityIdSchema,
    encounter: z
      .object({
        id: entityIdSchema.optional(),
        transcript: z.string().min(1).max(50_000),
        occurredAt: timestampSchema.optional(),
      })
      .strict(),
    agentRunId: entityIdSchema.optional(),
  })
  .strict();

export type UrgencyLevel = (typeof urgencyLevels)[number];
export type EvidenceKind = (typeof evidenceKinds)[number];
export type ProposedActionType = (typeof proposedActionTypes)[number];
export type EvidenceItem = z.output<typeof evidenceItemSchema>;
export type IdentifiedConcern = z.output<typeof identifiedConcernSchema>;
export type ProposedAction = z.output<typeof proposedActionSchema>;
export type Uncertainty = z.output<typeof uncertaintySchema>;
export type CareCoordinatorResult = z.output<typeof careCoordinatorResultSchema>;
export type CareCoordinatorStep = z.output<typeof careCoordinatorStepSchema>;
export type CareCoordinatorRunInput = z.output<typeof careCoordinatorRunInputSchema>;
