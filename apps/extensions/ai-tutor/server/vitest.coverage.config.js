import { defineConfig } from 'vitest/config';

/**
 * Coverage config — runs the unit AND integration suites in a single pass so the reported
 * number reflects the whole backend test inventory, not just unit tests.
 *
 * Integration tests need a PostgreSQL test database via DATABASE_URL; globalSetup syncs the
 * schema up front. Without a database the integration files fail, so this config is intended
 * for CI (and local runs with `npm run docker:dev:db` up), not the default `npm test` path.
 *
 * Coverage scope is application source under src/. The bootstrap entrypoint (src/index.js) is
 * excluded — it is process wiring, not request-path logic.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.js', 'tests/integration/**/*.test.js'],
    setupFiles: ['./tests/setup.js'],
    globalSetup: ['./tests/globalSetup.js'],
    testTimeout: 15000,
    hookTimeout: 30000,
    fileParallelism: false,
    pool: 'forks',
    coverage: {
      provider: 'v8',
      // Emit the summary even when some tests fail, so CI always gets a coverage figure.
      reportOnFailure: true,
      include: ['src/**/*.js'],
      exclude: ['src/index.js'],
      // lcov.info feeds the per-PR patch-coverage warning (pr-coverage.yml); json-summary
      // feeds the scheduled full-suite report. Both stay gitignored under coverage/.
      reporter: ['text-summary', 'json-summary', 'lcov'],
    },
  },
});
