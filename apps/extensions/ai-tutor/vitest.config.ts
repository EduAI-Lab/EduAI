import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['app/tests/**/*.test.{ts,tsx}'],
    setupFiles: ['./app/tests/setup.ts'],
  },
});
