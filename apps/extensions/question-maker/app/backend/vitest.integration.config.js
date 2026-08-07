import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.integration.test.js'],
    setupFiles: ['tests/setup.js'],
    // Sync the schema once up front so files that truncate in beforeEach never race the
    // first file's schema creation (see tests/globalSetup.js). No-op without TEST_DATABASE_URL.
    globalSetup: ['tests/globalSetup.js'],
    // Silence the pino logger (request logs + EduAI init/warn + intentional
    // failure-path warnings) before any module loads. Override with LOG_LEVEL=info to debug.
    env: { LOG_LEVEL: process.env.LOG_LEVEL || 'silent' },
    fileParallelism: false,
    pool: 'forks',
  },
});
