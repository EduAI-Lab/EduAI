import { defineConfig } from 'vitest/config'

/**
 * Coverage config — runs the unit AND integration suites in a single pass so the reported
 * number reflects the whole frontend test inventory, not just unit tests.
 *
 * The two suites need different environments (unit → jsdom, integration → node), so they are
 * wired as separate vitest projects that reference the existing per-suite configs. Coverage is
 * aggregated across both at the root level here.
 */
export default defineConfig({
  test: {
    projects: [
      { extends: './vitest.unit.config.ts', test: { name: 'unit' } },
      { extends: './vitest.integration.config.ts', test: { name: 'integration' } },
    ],
    coverage: {
      provider: 'v8',
      // Emit the summary even when some tests fail, so CI always gets a coverage figure.
      reportOnFailure: true,
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/tests/**', 'src/**/*.test.{ts,tsx}', 'src/**/*.d.ts', 'src/main.tsx'],
      reporter: ['text-summary', 'json-summary'],
    },
  },
})
