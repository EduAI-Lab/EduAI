import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['app/__tests__/**/*.test.{ts,tsx}'],
    setupFiles: ['./app/__tests__/setup.ts'],
  },
});
