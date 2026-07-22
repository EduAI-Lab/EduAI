import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // happy-dom matches the core app's test environment and avoids the
    // jsdom@29 → @exodus/bytes ESM require issue.
    environment: 'happy-dom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/tests/setup.ts'],
    coverage: {
      provider: 'v8',
      // Emit the summary even when some tests fail, so CI always gets a coverage figure.
      reportOnFailure: true,
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/tests/**'],
      reporter: ['text-summary', 'json-summary'],
    },
  },
});
