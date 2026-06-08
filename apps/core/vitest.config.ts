import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    include: ['app/tests/unit/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    fileParallelism: false,
    setupFiles: ['./app/tests/setup.ts'],
  },
});
