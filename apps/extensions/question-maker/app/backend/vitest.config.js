import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.js'],
    setupFiles: ['tests/setup.js'],
    fileParallelism: false,
    pool: 'forks',
    env: { LOG_LEVEL: process.env.LOG_LEVEL || 'silent' },
  },
});
