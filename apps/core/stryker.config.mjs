// @ts-check
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  packageManager: 'npm',
  testRunner: 'vitest',
  coverageAnalysis: 'perTest',
  reporters: ['html', 'clear-text', 'progress'],
  vitest: {
    // A separate, narrowed test config (not the main vitest.config.ts) —
    // its `include` allowlists only the test files covering the modules
    // mutated below. This is necessary because Stryker's dry run requires
    // the entire included suite to pass, and the full app/tests/unit suite
    // both times out here and includes embedding.rag-settings.test.ts,
    // which requires a local Ollama instance (a pre-existing, unrelated gap).
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
