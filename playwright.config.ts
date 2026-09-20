import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config.
 * - workers=1: sandbox RAM is ~2 GB (see PROGRESS.md known issues).
 * - The dev server is started by `npm run test:e2e` (playwright config
 *   `webServer`) so a full-journey run needs zero manual steps.
 * - Viewports: desktop (1280x800) and mobile (390x844, mid-range Android).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120000,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: true,
    timeout: 180000,
  },
});
