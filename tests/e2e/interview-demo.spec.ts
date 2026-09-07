import { expect, test, type Page } from "@playwright/test";

import { seedIds } from "@/lib/db/seed";

import {
  CLINICIAN_COOKIE,
  clinicians,
  messageAction,
  seedCanonicalInterviewRun,
} from "./fixtures";

async function signIn(page: Page, clinicianId: string, baseURL: string | undefined) {
  await page.context().addCookies([
    {
      name: CLINICIAN_COOKIE,
      value: clinicianId,
      url: baseURL ?? "http://localhost:3000",
    },
  ]);
}

test.describe("10-minute interview demo path", () => {
  test("home shows the architecture claim used in the walkthrough", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("architecture-flow")).toHaveText(
      "Agent → Tools → Policy → Human → Action",
    );
    await expect(page.getByRole("link", { name: "Clinician review dashboard" })).toBeVisible();
  });

  test("Blake can open the tagged Ava run, retrieval trace, and pending message", async ({
    page,
    baseURL,
  }) => {
    const run = await seedCanonicalInterviewRun();
    const message = messageAction(run);
    await signIn(page, clinicians.coordinator, baseURL);

    await page.goto("/reviews");
    await expect(page.getByTestId("interview-demo-badge")).toBeVisible();
    await expect(page.getByText(seedIds.agentRuns.avaReview)).toBeVisible();

    await page.goto(`/reviews/${run.runId}`);
    await expect(page.locator('[data-section="patient"]')).toContainText("Ava Nguyen (FICTIONAL)");
    await expect(page.locator('[data-section="encounter"]')).toBeVisible();
    await expect(page.locator('[data-section="evidence"]')).toContainText("cite:kb_diabetes_followup");
    await expect(page.locator('[data-section="safety-review"]')).toContainText(
      "draft_patient_message requires human approval before send",
    );
    await expect(page.getByTestId(`policy-${message.id}`)).toContainText("human approval required");
    await expect(page.getByTestId(`approve-${message.id}`)).toBeVisible();

    await page.goto(`/reviews/${run.runId}/trace`);
    const timeline = page.getByTestId("trace-timeline");
    await expect(timeline).toContainText("getPatientContext");
    await expect(timeline).toContainText("getRecentEncounters");
    await expect(timeline).toContainText("getCarePlan");
    await expect(timeline).toContainText("searchClinicalKnowledge");
  });
});
