// @ts-check
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  packageManager: 'npm',
  testRunner: 'vitest',
  coverageAnalysis: 'perTest',
  reporters: ['html', 'clear-text', 'progress'],
  vitest: {
    // Excludes embedding.rag-settings.test.ts, which requires a local Ollama
    // instance and fails in this environment regardless of mutation testing —
    // a pre-existing gap unrelated to the modules mutated below.
    configFile: 'vitest.mutation.config.ts',
  },
  mutate: [
    'app/lib/rbac/permissions.ts',
    'app/lib/rbac/index.ts',
    'app/lib/rbac/resolve-course-access.server.ts',
    'app/lib/auth/course-access.server.ts',
    'app/lib/auth/guards.server.ts',
    'app/lib/canvas/encryption.ts',
    'app/lib/auth/password-policy.ts',
    'app/lib/auth/password-expiry.server.ts',
    'app/lib/auth/password-history.server.ts',
    'app/lib/auth/rate-limit.server.ts',
    'app/lib/canvas/guards.server.ts',
  ],
};

export default config;
