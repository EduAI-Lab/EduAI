import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { baseVitestConfig } from './vitest.shared';

const coreDir = path.dirname(fileURLToPath(import.meta.url));
const base = baseVitestConfig(coreDir);

/**
 * Coverage config — runs the unit AND integration suites in a single pass so the reported
 * number reflects the whole backend test inventory, not just unit tests.
 *
 * The two suites need different environments (unit → happy-dom, integration → node) and
 * different setup, so they are wired as separate vitest projects that reference the existing
 * per-suite configs. Coverage is aggregated across both at the root level here.
 *
 * Integration tests need a PostgreSQL test database via DATABASE_URL; globalSetup syncs the
 * schema up front. This config is intended for CI (and local runs with `npm run docker:dev:db`
 * up), not the default `npm test` path.
 */
export default defineConfig({
  ...base,
  test: {
    projects: [
      { extends: 'vitest.config.ts', test: { name: 'unit' } },
      { extends: 'vitest.integration.config.ts', test: { name: 'integration' } },
    ],
    coverage: {
      provider: 'v8',
      // Emit the summary even when some tests fail, so CI always gets a coverage figure.
      reportOnFailure: true,
      include: ['app/**/*.{ts,tsx}'],
      exclude: ['app/tests/**', 'app/**/*.test.{ts,tsx}', 'app/**/*.d.ts', 'app/root.tsx', 'app/routes.ts'],
      reporter: ['text-summary', 'json-summary'],
    },
  },
});
