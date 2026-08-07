import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.js'],
    // *.integration.test.js needs the schema sync in vitest.integration.config.js's
    // globalSetup; when TEST_DATABASE_URL is set (CI), running those files here would
    // hit a database with no tables yet. They run via `npm run test:integration`.
    exclude: [...configDefaults.exclude, 'tests/**/*.integration.test.js'],
    setupFiles: ['tests/setup.js'],
    fileParallelism: false,
    pool: 'forks',
    env: { LOG_LEVEL: process.env.LOG_LEVEL || 'silent' },
  },
});
