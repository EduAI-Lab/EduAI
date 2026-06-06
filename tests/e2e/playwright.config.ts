import { defineConfig, devices } from '@playwright/test';

/**
 * Service URLs are injected by docker-compose.e2e.yml and fall back to
 * localhost ports that match the host-port bindings in that file, so tests
 * can also be run locally against a running `docker compose -f docker-compose.e2e.yml up`.
 */
const CORE_URL         = process.env.CORE_URL          ?? 'http://localhost:3000';
const AI_TUTOR_URL     = process.env.AI_TUTOR_URL      ?? 'http://localhost:3001';
const AI_TUTOR_API_URL = process.env.AI_TUTOR_SERVER_URL ?? 'http://localhost:4000';
const QM_BACKEND_URL   = process.env.QM_BACKEND_URL    ?? 'http://localhost:8000';
const QM_FRONTEND_URL  = process.env.QM_FRONTEND_URL   ?? 'http://localhost:5173';

export { CORE_URL, AI_TUTOR_URL, AI_TUTOR_API_URL, QM_BACKEND_URL, QM_FRONTEND_URL };

export default defineConfig({
  testDir: './tests',
  /* Run all tests in parallel */
  fullyParallel: false,
  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: !!process.env.CI,
  /* Retry failed tests once in CI */
  retries: process.env.CI ? 1 : 0,
  /* Single worker in CI to keep resource usage predictable inside Docker */
  workers: process.env.CI ? 1 : undefined,

  reporter: process.env.CI
    ? [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : [['list'], ['html', { outputFolder: 'playwright-report' }]],

  use: {
    /* Default base URL is Core — adjust per-test with page.goto() or a fixture */
    baseURL: process.env.BASE_URL ?? CORE_URL,
    /* Capture trace on first retry for easier debugging */
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    /* Uncomment to add more browsers as the suite matures */
    // { name: 'firefox',  use: { ...devices['Desktop Firefox'] } },
    // { name: 'webkit',   use: { ...devices['Desktop Safari'] } },
  ],
});
