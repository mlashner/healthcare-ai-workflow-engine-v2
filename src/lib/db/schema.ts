import { relations } from "drizzle-orm";
import {
  date,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import {
  agentEventTypes,
  agentRunStatuses,
  approvalStatuses,
  careTaskPriorities,
  careTaskStatuses,
  careTaskTypes,
  clinicalDocumentSources,
  providerRoles,
} from "../domain/enums";
import type { ApprovalAction, Condition, Medication } from "../domain/validation";

export const providerRoleEnum = pgEnum("provider_role", providerRoles);
export const clinicalDocumentSourceEnum = pgEnum(
  "clinical_document_source",
  clinicalDocumentSources,
);
export const careTaskTypeEnum = pgEnum("care_task_type", careTaskTypes);
export const careTaskPriorityEnum = pgEnum("care_task_priority", careTaskPriorities);
export const careTaskStatusEnum = pgEnum("care_task_status", careTaskStatuses);
export const agentRunStatusEnum = pgEnum("agent_run_status", agentRunStatuses);
export const agentEventTypeEnum = pgEnum("agent_event_type", agentEventTypes);
export const approvalStatusEnum = pgEnum("approval_status", approvalStatuses);

/**
 * Control-plane metadata. Domain tables below store fictional demonstration
 * records only — not real patient information.
 */
export const schemaInfo = pgTable("schema_info", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const patients = pgTable("patients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  dateOfBirth: date("date_of_birth", { mode: "string" }).notNull(),
  conditions: jsonb("conditions").$type<Condition[]>().notNull().default([]),
  medications: jsonb("medications").$type<Medication[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const providers = pgTable("providers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  role: providerRoleEnum("role").notNull(),
});

export const encounters = pgTable(
  "encounters",
  {
    id: text("id").primaryKey(),
    patientId: text("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "restrict" }),
    providerId: text("provider_id")
      .notNull()
      .references(() => providers.id, { onDelete: "restrict" }),
    transcript: text("transcript").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("encounters_patient_id_idx").on(table.patientId),
    index("encounters_provider_id_idx").on(table.providerId),
  ],
);

export const clinicalDocuments = pgTable(
  "clinical_documents",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    source: clinicalDocumentSourceEnum("source").notNull(),
    version: text("version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("clinical_documents_source_idx").on(table.source)],
);

export const careTasks = pgTable(
  "care_tasks",
  {
    id: text("id").primaryKey(),
    patientId: text("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "restrict" }),
    type: careTaskTypeEnum("type").notNull(),
    description: text("description").notNull(),
    priority: careTaskPriorityEnum("priority").notNull(),
    status: careTaskStatusEnum("status").notNull(),
    assignedTo: text("assigned_to").references(() => providers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("care_tasks_patient_id_idx").on(table.patientId),
    index("care_tasks_assigned_to_idx").on(table.assignedTo),
  ],
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    patientId: text("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "restrict" }),
    agentName: text("agent_name").notNull(),
    status: agentRunStatusEnum("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [index("agent_runs_patient_id_idx").on(table.patientId)],
);

export const agentEvents = pgTable(
  "agent_events",
  {
    id: text("id").primaryKey(),
    agentRunId: text("agent_run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    eventType: agentEventTypeEnum("event_type").notNull(),
    toolName: text("tool_name"),
    input: jsonb("input").$type<unknown>(),
    output: jsonb("output").$type<unknown>(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("agent_events_agent_run_id_idx").on(table.agentRunId)],
);

export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: text("id").primaryKey(),
    agentRunId: text("agent_run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    action: jsonb("action").$type<ApprovalAction>().notNull(),
    status: approvalStatusEnum("status").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewer: text("reviewer"),
    reason: text("reason"),
  },
  (table) => [index("approval_requests_agent_run_id_idx").on(table.agentRunId)],
);

export const patientsRelations = relations(patients, ({ many }) => ({
  encounters: many(encounters),
  careTasks: many(careTasks),
  agentRuns: many(agentRuns),
}));

export const providersRelations = relations(providers, ({ many }) => ({
  encounters: many(encounters),
  assignedCareTasks: many(careTasks),
}));

export const encountersRelations = relations(encounters, ({ one }) => ({
  patient: one(patients, { fields: [encounters.patientId], references: [patients.id] }),
  provider: one(providers, { fields: [encounters.providerId], references: [providers.id] }),
}));

export const careTasksRelations = relations(careTasks, ({ one }) => ({
  patient: one(patients, { fields: [careTasks.patientId], references: [patients.id] }),
  assignee: one(providers, { fields: [careTasks.assignedTo], references: [providers.id] }),
}));

export const agentRunsRelations = relations(agentRuns, ({ one, many }) => ({
  patient: one(patients, { fields: [agentRuns.patientId], references: [patients.id] }),
  events: many(agentEvents),
  approvalRequests: many(approvalRequests),
}));

export const agentEventsRelations = relations(agentEvents, ({ one }) => ({
  agentRun: one(agentRuns, { fields: [agentEvents.agentRunId], references: [agentRuns.id] }),
}));

export const approvalRequestsRelations = relations(approvalRequests, ({ one }) => ({
  agentRun: one(agentRuns, {
    fields: [approvalRequests.agentRunId],
    references: [agentRuns.id],
  }),
}));
