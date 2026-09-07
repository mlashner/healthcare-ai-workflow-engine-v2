import { expect, test } from "@playwright/test";

import { CLINICIAN_COOKIE, clinicians, seedFreshRun } from "./fixtures";

test.describe("agent trace", () => {
  test("shows a chronological trail and filters by event type", async ({ page, baseURL }) => {
    const run = await seedFreshRun();
    await page.context().addCookies([
      {
        name: CLINICIAN_COOKIE,
        value: clinicians.coordinator,
        url: baseURL ?? "http://localhost:3000",
      },
    ]);

    await page.goto(`/reviews/${run.runId}/trace`);
    await expect(page.getByRole("heading", { name: "Agent trace" })).toBeVisible();
    await expect(page.getByTestId("trace-event-agent_started").first()).toBeVisible();
    await expect(page.getByTestId("trace-event-recommendation_generated").first()).toBeVisible();
    await expect(page.getByTestId("trace-event-safety_review").first()).toBeVisible();
    await expect(page.getByTestId("trace-event-approval_requested").first()).toBeVisible();

    const reasoning = page.getByTestId("trace-event-model_reasoning");
    await expect(reasoning.first()).toBeVisible();
    await page.getByTestId("trace-filter-model_reasoning").uncheck();
    await expect(reasoning).toHaveCount(0);
    await expect(page.getByTestId("trace-event-agent_started").first()).toBeVisible();
  });

  test("does not leak secrets or chart demographics in the rendered payload", async ({
    page,
    baseURL,
  }) => {
    const run = await seedFreshRun();
    await page.context().addCookies([
      {
        name: CLINICIAN_COOKIE,
        value: clinicians.coordinator,
        url: baseURL ?? "http://localhost:3000",
      },
    ]);
    await page.goto(`/reviews/${run.runId}/trace`);
    const body = await page.locator("main").innerText();
    expect(body).not.toMatch(/sk-|password\s*[:=]|api[_-]?key/i);
    expect(body).not.toContain("1978-06-21");
  });

  test("hides traces outside the clinician's scope", async ({ page, baseURL }) => {
    const run = await seedFreshRun();
    await page.context().addCookies([
      {
        name: CLINICIAN_COOKIE,
        value: clinicians.outsider,
        url: baseURL ?? "http://localhost:3000",
      },
    ]);
    const response = await page.goto(`/reviews/${run.runId}/trace`);
    expect(response?.status()).toBe(404);
  });
});
