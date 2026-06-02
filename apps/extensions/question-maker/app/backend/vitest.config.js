import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.js'],
    exclude: ['tests/**/*.integration.test.js'],
    setupFiles: ['tests/setup.js'],
    // Silence the pino logger (request logs + EduAI init/warn + intentional
    // failure-path warnings) before any module loads. Override with LOG_LEVEL=info to debug.
    env: { LOG_LEVEL: process.env.LOG_LEVEL || 'silent' },
  },
});
