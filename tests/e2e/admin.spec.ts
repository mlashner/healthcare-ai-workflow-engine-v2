import { expect, test } from "@playwright/test";

test("admin observability dashboard shows aggregate AI metrics", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "AI observability" })).toBeVisible();
  await expect(page.getByTestId("metric-average-cost")).toContainText("Average cost/run");
  await expect(page.getByTestId("metric-p50-latency")).toContainText("p50 latency");
  await expect(page.getByTestId("metric-p95-latency")).toContainText("p95 latency");
  await expect(page.getByTestId("metric-average-tool-calls")).toContainText("Average tool calls");
  await expect(page.getByTestId("metric-model-failure-rate")).toContainText("Model failure rate");
  await expect(page.getByRole("heading", { name: "Evaluation score over time" })).toBeVisible();

  const body = await page.locator("main").innerText();
  expect(body).not.toContain("Ava Nguyen");
  expect(body).not.toContain("1978-06-21");
  expect(body).not.toMatch(/FICTIONAL ENCOUNTER/i);
});
