import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { listAuthorizedPatientIds, resolveClinician } from "@/authz/patient-access";
import { closeDb, getDb } from "@/lib/db/client";
import { createRepositories } from "@/lib/db/repositories";
import { seedFictionalData, seedIds } from "@/lib/db/seed";
import { seedReviewFixture, type SeededReviewRun } from "@/lib/db/seed-review";
import { loadClinicianReview } from "@/review/read-model";

const db = getDb();
const repos = createRepositories(db);
const accessDeps = {
  providers: repos.providers,
  encounters: repos.encounters,
  careTasks: repos.careTasks,
};

let run: SeededReviewRun;

beforeAll(async () => {
  await seedFictionalData(db);
  run = await seedReviewFixture(db, {
    runId: `run_it_${randomBytes(5).toString("hex")}`,
    patientId: seedIds.patients.ava,
  });
}, 60_000);

afterAll(async () => {
  await closeDb();
});

describe("clinician patient scope", () => {
  it("authorizes a coordinator through their assigned care task", async () => {
    const ids = await listAuthorizedPatientIds(accessDeps, seedIds.providers.blake);
    expect(ids).toContain(seedIds.patients.ava);
  });

  it("authorizes a physician through their encounter", async () => {
    const ids = await listAuthorizedPatientIds(accessDeps, seedIds.providers.vargas);
    expect(ids).toContain(seedIds.patients.ava);
  });

  it("grants no scope to a provider with no encounter and no assigned task", async () => {
    const ids = await listAuthorizedPatientIds(accessDeps, seedIds.providers.patel);
    expect(ids).toEqual([]);
  });

  it("reads the role from the store rather than the caller", async () => {
    const resolved = await resolveClinician(accessDeps, seedIds.providers.blake);
    expect(resolved?.actor.role).toBe("care_coordinator");
  });

  it("resolves nothing for an unknown identifier", async () => {
    expect(await resolveClinician(accessDeps, "provider_does_not_exist")).toBeNull();
    expect(await resolveClinician(accessDeps, null)).toBeNull();
  });
});

describe("clinician review read model", () => {
  it("assembles every section from durable records", async () => {
    const clinician = await resolveClinician(accessDeps, seedIds.providers.blake);
    const review = await loadClinicianReview(repos, run.runId, {
      actor: clinician!.actor,
      authorizedPatientIds: clinician!.authorizedPatientIds,
    });

    expect(review).not.toBeNull();
    expect(review!.patient?.name).toContain("Ava Nguyen");
    expect(review!.encounter?.transcript).toContain("FICTIONAL ENCOUNTER");
    expect(review!.summary).toContain("FICTIONAL DEMO");
    expect(review!.concerns).toHaveLength(1);
    expect(review!.proposedActions).toHaveLength(2);
    expect(review!.safety?.decision).toBe("approved");
    expect(review!.pendingActions).toHaveLength(2);
    expect(review!.executedActions).toEqual([]);
    expect(review!.approvalSummary).toEqual({ pending: 2, approved: 0, rejected: 0 });
  });

  it("resolves citations to real knowledge-base passages", async () => {
    const clinician = await resolveClinician(accessDeps, seedIds.providers.blake);
    const review = await loadClinicianReview(repos, run.runId, {
      actor: clinician!.actor,
      authorizedPatientIds: clinician!.authorizedPatientIds,
    });

    const retrieved = review!.evidence.filter((item) => item.kind === "retrieved");
    expect(retrieved.length).toBeGreaterThan(0);
    expect(retrieved[0]?.citationVerified).toBe(true);
    expect(retrieved[0]?.citationText).toBeTruthy();

    const inferred = review!.evidence.filter((item) => item.kind === "inferred");
    expect(inferred[0]?.citationId).toBeNull();
  });

  it("stamps a policy decision on each pending action", async () => {
    const clinician = await resolveClinician(accessDeps, seedIds.providers.blake);
    const review = await loadClinicianReview(repos, run.runId, {
      actor: clinician!.actor,
      authorizedPatientIds: clinician!.authorizedPatientIds,
    });

    for (const action of review!.pendingActions) {
      expect(action.policyDecision.allowed).toBe(true);
      expect(action.policyDecision.policyVersion).toBe("carepilot-policy-v1");
      expect(action.contentHash).toMatch(/^[a-f0-9]{16,}$/);
    }
  });

  it("returns nothing for a viewer outside the patient's scope", async () => {
    const review = await loadClinicianReview(repos, run.runId, {
      actor: { id: seedIds.providers.patel, role: "reviewer" },
      authorizedPatientIds: [],
    });

    expect(review).toBeNull();
  });

  it("skips a stored approval that is not a typed pending action", async () => {
    const clinician = await resolveClinician(accessDeps, seedIds.providers.blake);
    const review = await loadClinicianReview(repos, seedIds.agentRuns.avaCoordinator, {
      actor: clinician!.actor,
      authorizedPatientIds: clinician!.authorizedPatientIds,
    });

    // That run holds a free-form `propose_referral` approval, which cannot be
    // executed and so is never offered for decision.
    expect(review!.pendingActions).toEqual([]);
  });
});
