CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "document_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"citation_id" text NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(64) NOT NULL,
	"source" "clinical_document_source" NOT NULL,
	"version" text NOT NULL,
	"topics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_chunks_document_id_chunk_index_uidx" UNIQUE("document_id","chunk_index"),
	CONSTRAINT "document_chunks_citation_id_uidx" UNIQUE("citation_id")
);
--> statement-breakpoint
ALTER TABLE "clinical_documents" ADD COLUMN "topics" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_clinical_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."clinical_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_chunks_document_id_idx" ON "document_chunks" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_chunks_source_idx" ON "document_chunks" USING btree ("source");