import { defineConfig, devices } from "@playwright/test";

/**
 * Standalone Playwright config for real-browser layout tests (#1421 review
 * on #1320: Happy DOM classname assertions can't prove viewport-containment
 * geometry, only that certain classes are present).
 *
 * Deliberately independent of tests/e2e/playwright.config.ts: that suite's
 * globalSetup waits on the full docker-compose.e2e.yml stack (Core, AI
 * Tutor, QM backend) because its specs drive real app routes. These specs
 * render static HTML fixtures via page.setContent and need no server, no
 * DB, and no auth, so they run in-process with just a Chromium browser.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
