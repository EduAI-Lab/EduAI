import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      '@eduai/ui': path.resolve(__dirname, '../../../packages/ui/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['app/tests/**/*.test.{ts,tsx}'],
    setupFiles: ['./app/tests/setup.ts'],
  },
});
