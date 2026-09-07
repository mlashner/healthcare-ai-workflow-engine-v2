import { z } from "zod";

import {
  agentEventTypes,
  agentIdentities,
  agentRunStatuses,
  approvalStatuses,
  auditOutcomes,
  careTaskPriorities,
  careTaskStatuses,
  careTaskTypes,
  clinicalDocumentSources,
  providerRoles,
} from "./enums";

export const entityIdSchema = z.string().min(1).max(64);

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
  .refine(isCalendarDate, "invalid calendar date");

export const timestampSchema = z.coerce.date();

export const conditionSchema = z.object({
  name: z.string().min(1).max(200),
  notes: z.string().max(1000).optional(),
});

export const medicationSchema = z.object({
  name: z.string().min(1).max(200),
  dosage: z.string().max(100).optional(),
  frequency: z.string().max(100).optional(),
});

export const jsonObjectSchema = z.record(z.string(), z.unknown());

export const approvalActionSchema = z.object({
  type: z.string().min(1).max(100),
  payload: jsonObjectSchema.default({}),
});

export const patientSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1).max(200),
  dateOfBirth: isoDateSchema,
  conditions: z.array(conditionSchema),
  medications: z.array(medicationSchema),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const createPatientSchema = patientSchema
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    id: entityIdSchema.optional(),
    conditions: z.array(conditionSchema).default([]),
    medications: z.array(medicationSchema).default([]),
  });

export const updatePatientSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  dateOfBirth: isoDateSchema.optional(),
  conditions: z.array(conditionSchema).optional(),
  medications: z.array(medicationSchema).optional(),
});

export const providerSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1).max(200),
  role: z.enum(providerRoles),
});

export const createProviderSchema = providerSchema.extend({
  id: entityIdSchema.optional(),
});

export const encounterSchema = z.object({
  id: entityIdSchema,
  patientId: entityIdSchema,
  providerId: entityIdSchema,
  transcript: z.string().min(1).max(50_000),
  occurredAt: timestampSchema,
});

export const createEncounterSchema = encounterSchema.extend({
  id: entityIdSchema.optional(),
  occurredAt: timestampSchema.optional(),
});

export const clinicalDocumentSchema = z.object({
  id: entityIdSchema,
  title: z.string().min(1).max(300),
  content: z.string().min(1).max(50_000),
  source: z.enum(clinicalDocumentSources),
  version: z.string().min(1).max(50),
  createdAt: timestampSchema,
});

export const createClinicalDocumentSchema = clinicalDocumentSchema
  .omit({ id: true, createdAt: true })
  .extend({
    id: entityIdSchema.optional(),
    version: z.string().min(1).max(50).default("1"),
  });

export const careTaskSchema = z.object({
  id: entityIdSchema,
  patientId: entityIdSchema,
  type: z.enum(careTaskTypes),
  description: z.string().min(1).max(2000),
  priority: z.enum(careTaskPriorities),
  status: z.enum(careTaskStatuses),
  assignedTo: entityIdSchema.nullable(),
  createdAt: timestampSchema,
});

export const createCareTaskSchema = careTaskSchema
  .omit({ id: true, createdAt: true })
  .extend({
    id: entityIdSchema.optional(),
    assignedTo: entityIdSchema.nullable().optional(),
    status: z.enum(careTaskStatuses).default("draft"),
    priority: z.enum(careTaskPriorities).default("medium"),
  });

export const updateCareTaskSchema = z.object({
  type: z.enum(careTaskTypes).optional(),
  description: z.string().min(1).max(2000).optional(),
  priority: z.enum(careTaskPriorities).optional(),
  status: z.enum(careTaskStatuses).optional(),
  assignedTo: entityIdSchema.nullable().optional(),
});

export const agentRunSchema = z.object({
  id: entityIdSchema,
  patientId: entityIdSchema,
  agentName: z.string().min(1).max(100),
  status: z.enum(agentRunStatuses),
  startedAt: timestampSchema,
  completedAt: timestampSchema.nullable(),
});

export const createAgentRunSchema = agentRunSchema
  .omit({ id: true, startedAt: true, completedAt: true })
  .extend({
    id: entityIdSchema.optional(),
    status: z.enum(agentRunStatuses).default("queued"),
    startedAt: timestampSchema.optional(),
    completedAt: timestampSchema.nullable().optional(),
  });

export const updateAgentRunSchema = z.object({
  status: z.enum(agentRunStatuses).optional(),
  completedAt: timestampSchema.nullable().optional(),
});

export const agentEventSchema = z.object({
  id: entityIdSchema,
  agentRunId: entityIdSchema,
  eventType: z.enum(agentEventTypes),
  toolName: z.string().min(1).max(100).nullable(),
  input: z.unknown(),
  output: z.unknown(),
  timestamp: timestampSchema,
});

export const createAgentEventSchema = agentEventSchema
  .omit({ id: true, timestamp: true })
  .extend({
    id: entityIdSchema.optional(),
    toolName: z.string().min(1).max(100).nullable().optional(),
    input: z.unknown().optional(),
    output: z.unknown().optional(),
    timestamp: timestampSchema.optional(),
  });

export const approvalRequestSchema = z.object({
  id: entityIdSchema,
  agentRunId: entityIdSchema,
  action: approvalActionSchema,
  status: z.enum(approvalStatuses),
  requestedAt: timestampSchema,
  reviewedAt: timestampSchema.nullable(),
  reviewer: z.string().min(1).max(200).nullable(),
  reason: z.string().min(1).max(2000).nullable(),
});

export const createApprovalRequestSchema = approvalRequestSchema
  .omit({ id: true, requestedAt: true, reviewedAt: true, reviewer: true, reason: true })
  .extend({
    id: entityIdSchema.optional(),
    status: z.enum(approvalStatuses).default("pending"),
    requestedAt: timestampSchema.optional(),
    reviewedAt: timestampSchema.nullable().optional(),
    reviewer: z.string().min(1).max(200).nullable().optional(),
    reason: z.string().min(1).max(2000).nullable().optional(),
  });

export const auditEventSchema = z.object({
  id: entityIdSchema,
  agentRunId: entityIdSchema,
  toolName: z.string().min(1).max(100),
  outcome: z.enum(auditOutcomes),
  code: z.string().min(1).max(64),
  message: z.string().min(1).max(2000),
  actorId: entityIdSchema,
  agentName: z.enum(agentIdentities),
  patientScope: entityIdSchema,
  input: z.unknown(),
  details: z.unknown(),
  createdAt: timestampSchema,
});

export const createAuditEventSchema = auditEventSchema
  .omit({ id: true, createdAt: true })
  .extend({
    id: entityIdSchema.optional(),
    input: z.unknown().optional(),
    details: z.unknown().optional(),
  });

export const updateApprovalRequestSchema = z.object({
  status: z.enum(approvalStatuses).optional(),
  reviewedAt: timestampSchema.nullable().optional(),
  reviewer: z.string().min(1).max(200).nullable().optional(),
  reason: z.string().min(1).max(2000).nullable().optional(),
});

export type Condition = z.output<typeof conditionSchema>;
export type Medication = z.output<typeof medicationSchema>;
export type ApprovalAction = z.output<typeof approvalActionSchema>;
export type Patient = z.output<typeof patientSchema>;
export type CreatePatient = z.input<typeof createPatientSchema>;
export type UpdatePatient = z.input<typeof updatePatientSchema>;
export type Provider = z.output<typeof providerSchema>;
export type CreateProvider = z.input<typeof createProviderSchema>;
export type Encounter = z.output<typeof encounterSchema>;
export type CreateEncounter = z.input<typeof createEncounterSchema>;
export type ClinicalDocument = z.output<typeof clinicalDocumentSchema>;
export type CreateClinicalDocument = z.input<typeof createClinicalDocumentSchema>;
export type CareTask = z.output<typeof careTaskSchema>;
export type CreateCareTask = z.input<typeof createCareTaskSchema>;
export type UpdateCareTask = z.input<typeof updateCareTaskSchema>;
export type AgentRun = z.output<typeof agentRunSchema>;
export type CreateAgentRun = z.input<typeof createAgentRunSchema>;
export type UpdateAgentRun = z.input<typeof updateAgentRunSchema>;
export type AgentEvent = z.output<typeof agentEventSchema>;
export type CreateAgentEvent = z.input<typeof createAgentEventSchema>;
export type ApprovalRequest = z.output<typeof approvalRequestSchema>;
export type CreateApprovalRequest = z.input<typeof createApprovalRequestSchema>;
export type UpdateApprovalRequest = z.input<typeof updateApprovalRequestSchema>;
export type AuditEvent = z.output<typeof auditEventSchema>;
export type CreateAuditEvent = z.input<typeof createAuditEventSchema>;

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
