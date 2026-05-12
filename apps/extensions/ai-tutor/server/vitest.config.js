import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.js'],
    setupFiles: ['./test/setup.js'],
    globalSetup: ['./test/globalSetup.js'],
    testTimeout: 15000,
    hookTimeout: 30000,
    fileParallelism: false,
    pool: 'forks',
  },
});
