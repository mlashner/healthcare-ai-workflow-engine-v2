CREATE TABLE "schema_info" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

INSERT INTO "schema_info" ("key", "value")
VALUES
	('app_name', 'carepilot'),
	('data_classification', 'fictional')
ON CONFLICT ("key") DO NOTHING;
