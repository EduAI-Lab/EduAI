import { defineConfig } from "@playwright/test";

/**
 * Config for the real-browser diagram-layout regression (#1320). Separate
 * from the monorepo's docker-based `tests/e2e` suite: these tests don't
 * need Core/DB/auth running — they render component markup directly against
 * the app's compiled Tailwind CSS and check actual Chromium layout, so they
 * can run standalone in CI or locally with no server.
 */
export default defineConfig({
  testDir: "./app/tests/visual",
  globalSetup: "./app/tests/visual/global-setup.ts",
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
});
