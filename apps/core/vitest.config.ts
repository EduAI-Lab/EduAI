import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

const coreDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      // More specific subpath must precede the barrel alias (prefix match).
      '@eduai/ui/term-boundary-fixtures': path.resolve(coreDir, '../../packages/ui/src/tests/fixtures/term-boundary-fixtures.ts'),
      '@eduai/ui/term': path.resolve(coreDir, '../../packages/ui/src/lib/term.ts'),
      '@eduai/ui/tooltip': path.resolve(coreDir, '../../packages/ui/src/ui/tooltip.tsx'),
      '@eduai/ui/sonner': path.resolve(coreDir, '../../packages/ui/src/ui/sonner.tsx'),
      '@eduai/ui/page-loader': path.resolve(coreDir, '../../packages/ui/src/page-loader.tsx'),
      '@eduai/ui/theme-provider': path.resolve(coreDir, '../../packages/ui/src/theme-provider.tsx'),
      '@eduai/ui/theme-sync-initializer': path.resolve(coreDir, '../../packages/ui/src/theme-sync-initializer.tsx'),
      '@eduai/ui': path.resolve(coreDir, '../../packages/ui/src/index.ts'),
    },
  },
  test: {
    globals: true,
    // happy-dom avoids jsdom@29 → html-encoding-sniffer → @exodus/bytes ERR_REQUIRE_ESM
    environment: 'happy-dom',
    include: ['app/tests/unit/**/*.test.{ts,tsx}'],
    fileParallelism: false,
    setupFiles: ['./app/tests/setup.ts'],
  },
});
