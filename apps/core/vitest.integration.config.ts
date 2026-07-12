import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    include: ['app/tests/integration/**/*.test.ts'],
    globalSetup: ['./app/tests/globalSetup.ts'],
    environment: 'node',
    fileParallelism: false,
    setupFiles: ['./app/tests/setup.ts', './app/tests/setup.integration.ts'],
  },
});
