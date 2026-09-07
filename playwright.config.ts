import { defineConfig } from "@playwright/test";

const port = process.env.PORT ?? "3000";
// `localhost` matches the origin `next dev` serves its client chunks from.
// Reaching the dev server as 127.0.0.1 is treated as cross-origin and the
// page never hydrates.
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL,
    trace: "on-first-retry",
    // Defaults to Playwright's bundled Chromium. Set PLAYWRIGHT_CHANNEL=chrome
    // to drive a locally installed browser where the bundle is unavailable.
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
  },
  webServer: {
    command: "npm run dev",
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    env: {
      ...process.env,
      PORT: port,
    },
  },
});
