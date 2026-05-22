import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    include: ['app/tests/**/*.test.{ts,tsx}'],
    globalSetup: ['./app/tests/globalSetup.ts'],
    environment: 'jsdom',
    fileParallelism: false,
    setupFiles: ['./app/tests/setup.ts', './app/tests/setup.integration.ts'],
  },
});
