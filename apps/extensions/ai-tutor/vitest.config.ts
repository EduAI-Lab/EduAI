import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      // Subpath exports must precede the barrel: vite's alias matcher treats
      // '@eduai/ui' as also matching '@eduai/ui/<anything>', so the barrel alias
      // would rewrite subpaths to `.../src/index.ts/<subpath>`. Insertion order
      // is what keeps that from happening.
      '@eduai/ui/math-markdown': path.resolve(
        __dirname,
        '../../../packages/ui/src/lib/math-markdown.ts',
      ),
      '@eduai/ui': path.resolve(__dirname, '../../../packages/ui/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['app/tests/**/*.test.{ts,tsx}'],
    setupFiles: ['./app/tests/setup.ts'],
    coverage: {
      provider: 'v8',
      // Emit the summary even when some tests fail, so CI always gets a coverage figure.
      reportOnFailure: true,
      include: ['app/**/*.{ts,tsx}'],
      exclude: ['app/tests/**', 'app/**/*.test.{ts,tsx}', 'app/root.tsx', 'app/routes.ts'],
      // lcov.info feeds the per-PR patch-coverage warning (pr-coverage.yml); json-summary
      // feeds the scheduled full-suite report. Both stay gitignored under coverage/.
      reporter: ['text-summary', 'json-summary', 'lcov'],
    },
  },
});
