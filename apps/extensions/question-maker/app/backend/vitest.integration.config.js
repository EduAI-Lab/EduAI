import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.integration.test.js'],
    setupFiles: ['test/setup.js'],
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
