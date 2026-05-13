import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'jsdom',
    pool: 'vmThreads',
    include: ['app/__tests__/**/*.test.{ts,tsx}'],
    setupFiles: ['./app/__tests__/setup.ts'],
  },
});
