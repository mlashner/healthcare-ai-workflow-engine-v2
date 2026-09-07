import { z } from "zod";

import {
  approvalActionTypes,
  careTaskPriorities,
  careTaskTypes,
  citationIdSchema,
  clinicalDocumentSources,
  entityIdSchema,
  knowledgeTopics,
} from "@/lib/domain";

const patientIdField = {
  patientId: entityIdSchema,
};

export const getPatientContextInputSchema = z.object(patientIdField).strict();

export const getPatientContextOutputSchema = z.object({
  patientId: entityIdSchema,
  name: z.string(),
  dateOfBirth: z.string(),
  conditions: z.array(
    z.object({
      name: z.string(),
      notes: z.string().optional(),
    }),
  ),
  medications: z.array(
    z.object({
      name: z.string(),
      dosage: z.string().optional(),
      frequency: z.string().optional(),
    }),
  ),
});

export const getRecentEncountersInputSchema = z
  .object({
    patientId: entityIdSchema,
    limit: z.number().int().min(1).max(20).default(5),
  })
  .strict();

export const getRecentEncountersOutputSchema = z.object({
  patientId: entityIdSchema,
  encounters: z.array(
    z.object({
      id: entityIdSchema,
      providerId: entityIdSchema,
      occurredAt: z.coerce.date(),
      transcript: z.string(),
    }),
  ),
});

export const getCarePlanInputSchema = z.object(patientIdField).strict();

export const getCarePlanOutputSchema = z.object({
  patientId: entityIdSchema,
  tasks: z.array(
    z.object({
      id: entityIdSchema,
      type: z.enum(careTaskTypes),
      description: z.string(),
      priority: z.enum(careTaskPriorities),
      status: z.string(),
      assignedTo: entityIdSchema.nullable(),
    }),
  ),
});

export const searchClinicalKnowledgeInputSchema = z
  .object({
    query: z.string().min(2).max(200),
    limit: z.number().int().min(1).max(10).optional(),
    minSimilarity: z.number().min(0).max(1).optional(),
    source: z.enum(clinicalDocumentSources).optional(),
    version: z.string().min(1).max(50).optional(),
    topic: z.enum(knowledgeTopics).optional(),
  })
  .strict();

export const searchClinicalKnowledgeOutputSchema = z.object({
  query: z.string(),
  results: z.array(
    z.object({
      documentId: entityIdSchema,
      title: z.string(),
      relevantText: z.string(),
      similarityScore: z.number(),
      source: z.enum(clinicalDocumentSources),
      version: z.string(),
      citationId: citationIdSchema,
    }),
  ),
});

export const createCareTaskInputSchema = z
  .object({
    patientId: entityIdSchema,
    type: z.enum(careTaskTypes),
    description: z.string().min(1).max(2000),
    priority: z.enum(careTaskPriorities).optional(),
    assignedTo: entityIdSchema.nullable().optional(),
  })
  .strict();

export const createCareTaskOutputSchema = z.object({
  id: entityIdSchema,
  patientId: entityIdSchema,
  type: z.enum(careTaskTypes),
  description: z.string(),
  priority: z.enum(careTaskPriorities),
  status: z.literal("draft"),
  assignedTo: entityIdSchema.nullable(),
});

export const draftPatientMessageInputSchema = z
  .object({
    patientId: entityIdSchema,
    purpose: z.string().min(1).max(300),
    talkingPoints: z.array(z.string().min(1).max(500)).min(1).max(10),
  })
  .strict();

export const draftPatientMessageOutputSchema = z.object({
  careTaskId: entityIdSchema,
  patientId: entityIdSchema,
  body: z.string(),
  status: z.literal("draft"),
});

const approvalReason = z.string().min(1).max(2000).optional();

export const requestHumanApprovalInputSchema = z.discriminatedUnion("actionType", [
  z
    .object({
      actionType: z.literal("propose_referral"),
      payload: z
        .object({
          patientId: entityIdSchema,
          specialty: z.string().min(1).max(100).optional(),
          note: z.string().min(1).max(500).optional(),
        })
        .strict(),
      reason: approvalReason,
    })
    .strict(),
  z
    .object({
      actionType: z.literal("schedule_outreach"),
      payload: z
        .object({
          patientId: entityIdSchema,
          purpose: z.string().min(1).max(300).optional(),
          note: z.string().min(1).max(500).optional(),
        })
        .strict(),
      reason: approvalReason,
    })
    .strict(),
  z
    .object({
      actionType: z.literal("notify_care_team"),
      payload: z
        .object({
          patientId: entityIdSchema,
          message: z.string().min(1).max(500).optional(),
          note: z.string().min(1).max(500).optional(),
        })
        .strict(),
      reason: approvalReason,
    })
    .strict(),
]);

export const requestHumanApprovalOutputSchema = z.object({
  approvalRequestId: entityIdSchema,
  status: z.literal("pending"),
  action: z.object({
    type: z.enum(approvalActionTypes),
    payload: z.record(z.string(), z.unknown()),
  }),
  contentHash: z.string().min(1),
});

export type GetPatientContextInput = z.input<typeof getPatientContextInputSchema>;
export type GetPatientContextOutput = z.output<typeof getPatientContextOutputSchema>;
export type GetRecentEncountersInput = z.input<typeof getRecentEncountersInputSchema>;
export type GetRecentEncountersOutput = z.output<typeof getRecentEncountersOutputSchema>;
export type GetCarePlanInput = z.input<typeof getCarePlanInputSchema>;
export type GetCarePlanOutput = z.output<typeof getCarePlanOutputSchema>;
export type SearchClinicalKnowledgeInput = z.input<typeof searchClinicalKnowledgeInputSchema>;
export type SearchClinicalKnowledgeOutput = z.output<typeof searchClinicalKnowledgeOutputSchema>;
export type CreateCareTaskInput = z.input<typeof createCareTaskInputSchema>;
export type CreateCareTaskOutput = z.output<typeof createCareTaskOutputSchema>;
export type DraftPatientMessageInput = z.input<typeof draftPatientMessageInputSchema>;
export type DraftPatientMessageOutput = z.output<typeof draftPatientMessageOutputSchema>;
export type RequestHumanApprovalInput = z.input<typeof requestHumanApprovalInputSchema>;
export type RequestHumanApprovalOutput = z.output<typeof requestHumanApprovalOutputSchema>;
