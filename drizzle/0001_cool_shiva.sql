CREATE TYPE "public"."agent_event_type" AS ENUM('think', 'tool_call', 'tool_result', 'finish', 'error', 'safety_review', 'policy_decision');--> statement-breakpoint
CREATE TYPE "public"."agent_run_status" AS ENUM('queued', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."care_task_priority" AS ENUM('low', 'medium', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."care_task_status" AS ENUM('draft', 'pending_approval', 'approved', 'rejected', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."care_task_type" AS ENUM('referral', 'outreach', 'follow_up', 'care_gap', 'notify_care_team');--> statement-breakpoint
CREATE TYPE "public"."clinical_document_source" AS ENUM('knowledge_base', 'guideline', 'policy', 'reference');--> statement-breakpoint
CREATE TYPE "public"."provider_role" AS ENUM('physician', 'nurse', 'care_coordinator', 'pharmacist', 'social_worker', 'reviewer');--> statement-breakpoint
CREATE TABLE "agent_events" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_run_id" text NOT NULL,
	"event_type" "agent_event_type" NOT NULL,
	"tool_name" text,
	"input" jsonb,
	"output" jsonb,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL,
	"agent_name" text NOT NULL,
	"status" "agent_run_status" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_run_id" text NOT NULL,
	"action" jsonb NOT NULL,
	"status" "approval_status" NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewer" text,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "care_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL,
	"type" "care_task_type" NOT NULL,
	"description" text NOT NULL,
	"priority" "care_task_priority" NOT NULL,
	"status" "care_task_status" NOT NULL,
	"assigned_to" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinical_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"source" "clinical_document_source" NOT NULL,
	"version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "encounters" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"transcript" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"date_of_birth" date NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"medications" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"role" "provider_role" NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_tasks" ADD CONSTRAINT "care_tasks_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_tasks" ADD CONSTRAINT "care_tasks_assigned_to_providers_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_events_agent_run_id_idx" ON "agent_events" USING btree ("agent_run_id");--> statement-breakpoint
CREATE INDEX "agent_runs_patient_id_idx" ON "agent_runs" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "approval_requests_agent_run_id_idx" ON "approval_requests" USING btree ("agent_run_id");--> statement-breakpoint
CREATE INDEX "care_tasks_patient_id_idx" ON "care_tasks" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "care_tasks_assigned_to_idx" ON "care_tasks" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX "clinical_documents_source_idx" ON "clinical_documents" USING btree ("source");--> statement-breakpoint
CREATE INDEX "encounters_patient_id_idx" ON "encounters" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "encounters_provider_id_idx" ON "encounters" USING btree ("provider_id");