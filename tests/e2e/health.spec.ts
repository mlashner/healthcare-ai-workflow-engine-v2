import { expect, test } from "@playwright/test";

test("home page identifies the fictional demo", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "CarePilot" })).toBeVisible();
  await expect(page.getByText(/fictional data only/i)).toBeVisible();
  await expect(page.getByTestId("architecture-flow")).toHaveText(
    "Agent → Tools → Policy → Human → Action",
  );
});

test("health endpoint reports database status", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBeTruthy();

  const body = await response.json();
  expect(body.status).toBe("ok");
  expect(body.checks.database).toBe("ok");
});
