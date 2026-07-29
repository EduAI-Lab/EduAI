import { defineConfig } from 'vitest/config';

/**
 * Coverage config — runs the unit AND integration suites in a single pass so the reported
 * number reflects the whole backend test inventory (see TESTS.md), not just unit tests.
 *
 * Integration tests need a PostgreSQL test database via TEST_DATABASE_URL; without it they
 * self-skip and the figure collapses to unit-only coverage. globalSetup syncs the schema once
 * up front so the shared-worker run is deterministic.
 *
 * Coverage scope is application source under src/. Operational scripts (seeds/migrations) and
 * the server bootstrap entrypoint are excluded — they are not shipped request-path logic.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.js'],
    setupFiles: ['tests/setup.js'],
    globalSetup: ['tests/globalSetup.js'],
    env: { LOG_LEVEL: process.env.LOG_LEVEL || 'silent' },
    fileParallelism: false,
    pool: 'forks',
    coverage: {
      provider: 'v8',
      // Emit the summary even when some tests fail, so CI always gets a coverage figure.
      reportOnFailure: true,
      include: ['src/**/*.js'],
      exclude: ['src/index.js', 'src/generated/**'],
      // lcov.info feeds the per-PR patch-coverage warning (pr-coverage.yml); json-summary
      // feeds the scheduled full-suite report. Both stay gitignored under coverage/.
      reporter: ['text', 'text-summary', 'html', 'json-summary', 'lcov'],
    },
  },
});
