import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/**/*.test.js'],
    setupFiles: ['./tests/setup.js'],
    globalSetup: ['./tests/globalSetup.js'],
    testTimeout: 15000,
    hookTimeout: 30000,
    fileParallelism: false,
    pool: 'forks',
  },
});
