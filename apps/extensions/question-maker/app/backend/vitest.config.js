import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.test.js'],
    exclude: ['test/**/*.integration.test.js'],
    setupFiles: ['test/setup.js'],
  },
});
