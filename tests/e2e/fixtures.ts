import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { getDb } from "@/lib/db/client";
import { seedIds } from "@/lib/db/seed";
import { seedReviewFixture, type SeededReviewRun } from "@/lib/db/seed-review";

/**
 * Playwright runs outside Next, so the test process loads `.env` itself.
 * Fictional demo credentials only.
 */
export function loadEnv(): void {
  try {
    const contents = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const line of contents.split("\n")) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match?.[1] && process.env[match[1]] === undefined) {
        process.env[match[1]] = match[2];
      }
    }
  } catch {
    // Fall through to the local docker-compose default.
  }

  process.env.DATABASE_URL ??= "postgres://carepilot:carepilot@localhost:5432/carepilot";
  process.env.LOG_LEVEL ??= "info";
}

export const clinicians = {
  /** care_coordinator, holds Ava's assigned care task, so in scope. */
  coordinator: seedIds.providers.blake,
  /** reviewer with no encounter and no assigned task, so out of scope. */
  outsider: seedIds.providers.patel,
  /** pharmacist role, permitted by action policy but not by the tool policy. */
  pharmacist: seedIds.providers.okonkwo,
} as const;

export const CLINICIAN_HEADER = "x-carepilot-clinician";
export const CLINICIAN_COOKIE = "carepilot_clinician";

/**
 * Each test gets its own run so approving one does not disturb another and
 * the suite can run in parallel.
 */
export async function seedFreshRun(): Promise<SeededReviewRun> {
  loadEnv();
  const runId = `run_e2e_${randomBytes(6).toString("hex")}`;
  return seedReviewFixture(getDb(), { runId, patientId: seedIds.patients.ava });
}

/** Stable seeded run used by the 10-minute interview walkthrough. */
export async function seedCanonicalInterviewRun(): Promise<SeededReviewRun> {
  loadEnv();
  return seedReviewFixture(getDb(), {
    runId: seedIds.agentRuns.avaReview,
    patientId: seedIds.patients.ava,
    resetApprovals: true,
  });
}

export function careTaskAction(run: SeededReviewRun) {
  const action = run.pendingActions.find((item) => item.toolName === "createCareTask");
  if (!action) {
    throw new Error("fixture is missing a createCareTask pending action");
  }
  return action;
}

export function messageAction(run: SeededReviewRun) {
  const action = run.pendingActions.find((item) => item.toolName === "draftPatientMessage");
  if (!action) {
    throw new Error("fixture is missing a draftPatientMessage pending action");
  }
  return action;
}
