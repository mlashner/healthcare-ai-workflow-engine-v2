CREATE TYPE "public"."audit_outcome" AS ENUM('executed', 'denied', 'validation_error', 'unknown_tool', 'execution_error');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_run_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"outcome" "audit_outcome" NOT NULL,
	"code" text NOT NULL,
	"message" text NOT NULL,
	"actor_id" text NOT NULL,
	"agent_name" text NOT NULL,
	"patient_scope" text NOT NULL,
	"input" jsonb,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_agent_run_id_idx" ON "audit_events" USING btree ("agent_run_id");--> statement-breakpoint
CREATE INDEX "audit_events_tool_name_idx" ON "audit_events" USING btree ("tool_name");