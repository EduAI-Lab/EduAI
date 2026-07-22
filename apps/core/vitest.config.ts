import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

import { uiAliases } from './vitest.ui-aliases';

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: uiAliases,
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
