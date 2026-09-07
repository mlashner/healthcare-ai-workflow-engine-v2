import { closeDb, getDb } from "@/lib/db/client";
import { seedFictionalData } from "@/lib/db/seed";

import { loadEnv } from "./fixtures";

/**
 * Ensures the fictional providers, patients, and knowledge base exist before
 * the approval-flow suite runs. Individual tests then seed their own run.
 */
export default async function globalSetup(): Promise<void> {
  loadEnv();
  await seedFictionalData(getDb());
  await closeDb();
}
