import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.integration.test.js'],
    setupFiles: ['tests/setup.js'],
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
