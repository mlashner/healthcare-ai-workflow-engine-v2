import { expect, test, type Page } from "@playwright/test";

import {
  CLINICIAN_COOKIE,
  CLINICIAN_HEADER,
  careTaskAction,
  clinicians,
  messageAction,
  seedFreshRun,
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

test.describe("clinician review dashboard", () => {
  test("shows all nine review sections with distinct provenance", async ({ page, baseURL }) => {
    const run = await seedFreshRun();
    await signIn(page, clinicians.coordinator, baseURL);
    await page.goto(`/reviews/${run.runId}`);

    for (const section of [
      "patient",
      "encounter",
      "agent-summary",
      "concerns",
      "evidence",
      "proposed-actions",
      "safety-review",
      "pending-actions",
    ]) {
      await expect(page.locator(`[data-section="${section}"]`)).toBeVisible();
    }

    await expect(page.locator('[data-section="patient"]')).toContainText("Ava Nguyen (FICTIONAL)");
    await expect(page.locator('[data-section="agent-summary"]')).toContainText("FICTIONAL DEMO");
    await expect(page.locator('[data-section="safety-review"]')).toContainText("approved");

    // Section 8 (policy decision) and 9 (approval status) render per action.
    const action = careTaskAction(run);
    await expect(page.getByTestId(`policy-${action.id}`)).toContainText("Permitted by policy");
    await expect(page.getByTestId(`status-${action.id}`)).toHaveText("pending");
  });

  test("states that a recommendation is not an executed action", async ({ page, baseURL }) => {
    const run = await seedFreshRun();
    await signIn(page, clinicians.coordinator, baseURL);
    await page.goto(`/reviews/${run.runId}`);

    await expect(page.getByTestId("not-executed-banner")).toContainText(
      "AI recommendation ≠ executed action",
    );
    await expect(page.getByTestId("no-executed-actions")).toBeVisible();
  });

  test("renders a separate visual treatment for each of the six provenance kinds", async ({
    page,
    baseURL,
  }) => {
    const run = await seedFreshRun();
    await signIn(page, clinicians.coordinator, baseURL);
    await page.goto(`/reviews/${run.runId}`);

    const legend = page.locator('[aria-label="Provenance legend"]');
    for (const kind of ["retrieved", "reasoning", "proposal", "policy", "human", "executed"]) {
      await expect(legend.locator(`[data-legend="${kind}"]`)).toBeVisible();
    }

    // The distinction is real, not just a legend: retrieved chart content and
    // model reasoning render in different colours on the same page.
    const retrievedColor = await page
      .locator('[data-section="patient"] [data-provenance="retrieved"]')
      .evaluate((node) => getComputedStyle(node).backgroundColor);
    const reasoningColor = await page
      .locator('[data-section="agent-summary"] [data-provenance="reasoning"]')
      .evaluate((node) => getComputedStyle(node).backgroundColor);
    const proposalColor = await page
      .locator('[data-section="proposed-actions"] [data-provenance="proposal"]')
      .first()
      .evaluate((node) => getComputedStyle(node).backgroundColor);

    expect(new Set([retrievedColor, reasoningColor, proposalColor]).size).toBe(3);
  });

  test("hides runs for patients outside the clinician's scope", async ({ page, baseURL }) => {
    const run = await seedFreshRun();
    await signIn(page, clinicians.outsider, baseURL);

    const response = await page.goto(`/reviews/${run.runId}`);
    expect(response?.status()).toBe(404);
  });
});

test.describe("approval flow", () => {
  test("approving executes the action through the typed tool layer", async ({ page, baseURL }) => {
    const run = await seedFreshRun();
    const action = careTaskAction(run);
    await signIn(page, clinicians.coordinator, baseURL);
    await page.goto(`/reviews/${run.runId}`);

    await expect(page.getByTestId("no-executed-actions")).toBeVisible();
    await page.getByTestId(`approve-${action.id}`).click();

    await expect(page.getByTestId(`decision-result-${action.id}`)).toContainText(
      "executed through the tool gateway",
    );
    await expect(page.getByTestId(`status-${action.id}`)).toHaveText("approved");

    const executed = page.locator('[data-section="executed-actions"] [data-provenance="executed"]');
    await expect(executed.first()).toContainText("createCareTask");
    await expect(page.getByTestId("no-executed-actions")).toHaveCount(0);

    // The human decision is recorded distinctly from the execution.
    await expect(page.locator('[data-section="human-decisions"]')).toContainText("approved");
  });

  test("rejecting records the decision and executes nothing", async ({ page, baseURL }) => {
    const run = await seedFreshRun();
    const action = careTaskAction(run);
    await signIn(page, clinicians.coordinator, baseURL);
    await page.goto(`/reviews/${run.runId}`);

    await page.getByTestId(`reject-${action.id}`).click();

    await expect(page.getByTestId(`decision-result-${action.id}`)).toContainText(
      "Nothing was executed",
    );
    await expect(page.getByTestId(`status-${action.id}`)).toHaveText("rejected");
    await expect(page.getByTestId("no-executed-actions")).toBeVisible();
  });

  test("editing returns the action to pending under a new content hash", async ({
    page,
    baseURL,
  }) => {
    const run = await seedFreshRun();
    const action = careTaskAction(run);
    await signIn(page, clinicians.coordinator, baseURL);
    await page.goto(`/reviews/${run.runId}`);

    const hashBefore = await page.getByTestId(`hash-${action.id}`).innerText();

    await page.getByTestId(`edit-${action.id}`).click();
    await page
      .getByTestId(`edit-input-${action.id}`)
      .fill("Schedule a 7-day follow-up call instead.");
    await page.getByTestId(`edit-note-${action.id}`).fill("Shorter interval after the ED visit.");
    await page.getByTestId(`save-edit-${action.id}`).click();

    await expect(page.getByTestId(`decision-result-${action.id}`)).toContainText(
      "Nothing was executed",
    );
    await expect(page.getByTestId(`status-${action.id}`)).toHaveText("pending");
    await expect(page.getByTestId(`hash-${action.id}`)).not.toHaveText(hashBefore);
    await expect(page.getByTestId("no-executed-actions")).toBeVisible();

    // The revision is approvable on its own terms, under the new hash.
    await page.getByTestId(`approve-${action.id}`).click();
    await expect(page.getByTestId(`status-${action.id}`)).toHaveText("approved");
    await expect(
      page.locator('[data-section="executed-actions"] [data-provenance="executed"]').first(),
    ).toContainText("createCareTask");
  });

  test("a draft message needs approval and only then reaches the draft tool", async ({
    page,
    baseURL,
  }) => {
    const run = await seedFreshRun();
    const action = messageAction(run);
    await signIn(page, clinicians.coordinator, baseURL);
    await page.goto(`/reviews/${run.runId}`);

    await expect(page.getByTestId(`policy-${action.id}`)).toContainText(
      "human approval required",
    );

    await page.getByTestId(`approve-${action.id}`).click();
    await expect(page.getByTestId(`status-${action.id}`)).toHaveText("approved");
    await expect(
      page.locator('[data-section="executed-actions"] [data-provenance="executed"]').first(),
    ).toContainText("draftPatientMessage");
  });
});

test.describe("the frontend cannot bypass backend policy checks", () => {
  test("refuses a decision with no clinician identity", async ({ request }) => {
    const run = await seedFreshRun();
    const action = careTaskAction(run);

    const response = await request.post(`/api/reviews/${run.runId}/actions/${action.id}`, {
      data: { decision: "approve", expectedContentHash: action.contentHash },
    });

    expect(response.status()).toBe(401);
  });

  test("refuses a clinician outside the patient's scope", async ({ request }) => {
    const run = await seedFreshRun();
    const action = careTaskAction(run);

    const response = await request.post(`/api/reviews/${run.runId}/actions/${action.id}`, {
      headers: { [CLINICIAN_HEADER]: clinicians.outsider },
      data: { decision: "approve", expectedContentHash: action.contentHash },
    });

    expect(response.status()).toBe(403);
  });

  test("ignores a body that supplies its own tool, arguments, or role", async ({ request }) => {
    const run = await seedFreshRun();
    const action = careTaskAction(run);

    const response = await request.post(`/api/reviews/${run.runId}/actions/${action.id}`, {
      headers: { [CLINICIAN_HEADER]: clinicians.coordinator },
      data: {
        decision: "approve",
        expectedContentHash: action.contentHash,
        toolName: "createCareTask",
        args: { patientId: "patient_fictional_marcus", description: "escalated" },
        actor: { id: "provider_root", role: "physician" },
        policy: { allowed: true },
      },
    });

    expect(response.status()).toBe(400);
    expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
  });

  test("refuses an approval bound to a stale content hash", async ({ request }) => {
    const run = await seedFreshRun();
    const action = careTaskAction(run);

    const edited = await request.post(`/api/reviews/${run.runId}/actions/${action.id}`, {
      headers: { [CLINICIAN_HEADER]: clinicians.coordinator },
      data: {
        decision: "edit",
        expectedContentHash: action.contentHash,
        edits: { description: "A materially different task." },
      },
    });
    expect(edited.ok()).toBeTruthy();

    const replay = await request.post(`/api/reviews/${run.runId}/actions/${action.id}`, {
      headers: { [CLINICIAN_HEADER]: clinicians.coordinator },
      data: { decision: "approve", expectedContentHash: action.contentHash },
    });

    expect(replay.status()).toBe(409);
    expect((await replay.json()).error.code).toBe("CONTENT_HASH_MISMATCH");
  });

  test("refuses a second decision on an already decided action", async ({ request }) => {
    const run = await seedFreshRun();
    const action = careTaskAction(run);

    const first = await request.post(`/api/reviews/${run.runId}/actions/${action.id}`, {
      headers: { [CLINICIAN_HEADER]: clinicians.coordinator },
      data: { decision: "approve", expectedContentHash: action.contentHash },
    });
    expect(first.ok()).toBeTruthy();

    const second = await request.post(`/api/reviews/${run.runId}/actions/${action.id}`, {
      headers: { [CLINICIAN_HEADER]: clinicians.coordinator },
      data: { decision: "approve", expectedContentHash: action.contentHash },
    });

    expect(second.status()).toBe(409);
    expect((await second.json()).error.code).toBe("ALREADY_DECIDED");
  });

  test("refuses a pending action id borrowed from another run", async ({ request }) => {
    const [runA, runB] = await Promise.all([seedFreshRun(), seedFreshRun()]);
    const action = careTaskAction(runB);

    const response = await request.post(`/api/reviews/${runA.runId}/actions/${action.id}`, {
      headers: { [CLINICIAN_HEADER]: clinicians.coordinator },
      data: { decision: "approve", expectedContentHash: action.contentHash },
    });

    expect(response.status()).toBe(404);
  });

  test("refuses a decision verb outside the closed set", async ({ request }) => {
    const run = await seedFreshRun();
    const action = careTaskAction(run);

    const response = await request.post(`/api/reviews/${run.runId}/actions/${action.id}`, {
      headers: { [CLINICIAN_HEADER]: clinicians.coordinator },
      data: { decision: "execute", expectedContentHash: action.contentHash },
    });

    expect(response.status()).toBe(400);
  });

  test("rejects a cookie-authenticated decision from a foreign origin", async ({
    request,
  }) => {
    const run = await seedFreshRun();
    const action = careTaskAction(run);

    const response = await request.post(`/api/reviews/${run.runId}/actions/${action.id}`, {
      headers: {
        cookie: `${CLINICIAN_COOKIE}=${clinicians.coordinator}`,
        origin: "https://evil.example",
      },
      data: { decision: "approve", expectedContentHash: action.contentHash },
    });

    expect(response.status()).toBe(403);
    expect((await response.json()).error.code).toBe("CSRF_REJECTED");
  });

  test("accepts a cookie-authenticated decision from this origin", async ({ request, baseURL }) => {
    const run = await seedFreshRun();
    const action = careTaskAction(run);

    const response = await request.post(`/api/reviews/${run.runId}/actions/${action.id}`, {
      headers: {
        cookie: `${CLINICIAN_COOKIE}=${clinicians.coordinator}`,
        origin: new URL(baseURL ?? "http://localhost:3000").origin,
      },
      data: { decision: "approve", expectedContentHash: action.contentHash },
    });

    expect(response.ok()).toBeTruthy();
  });
});
