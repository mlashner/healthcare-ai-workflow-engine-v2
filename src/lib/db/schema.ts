import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Control-plane metadata only. Domain tables (runs, audit events, pending
 * actions) are added when those features are implemented. No AI state lives here.
 */
export const schemaInfo = pgTable("schema_info", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
