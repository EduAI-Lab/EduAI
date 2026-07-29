import fs from 'node:fs';
import path from 'node:path';
import tsconfigPaths from 'vite-tsconfig-paths';
import type { ViteUserConfig } from 'vitest/config';

import { uiAliases } from './vitest.ui-aliases';

// Walk up from a config file's directory until we find the monorepo root
// (identified by a packages/ui subdirectory). This must work both for a
// normal run (coreDir === apps/core) and inside Stryker's sandbox, where
// vitest.config.ts is copied to apps/core/.stryker-tmp/sandbox-XXXX/
// (two extra levels deep) — a fixed number of '..' segments breaks in the
// sandbox case, so we search instead of hardcoding depth.
export function findMonorepoRoot(startDir: string): string {
  let dir = startDir;
  while (!fs.existsSync(path.join(dir, 'packages', 'ui'))) {
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not locate monorepo root (packages/ui) starting from ${startDir}`);
    }
    dir = parent;
  }
  return dir;
}

// Shared base for vitest.config.ts, vitest.mutation.config.ts, and
// vitest.coverage.config.ts, so plugins/aliases never drift (and so Stryker's
// nested sandbox still resolves @eduai/ui). Callers spread this and override
// `test` fields — plain object spread, not vite's mergeConfig, so `include`
// is a clean override rather than an array concatenation.
export function baseVitestConfig(coreDir: string): ViteUserConfig {
  const rootDir = findMonorepoRoot(coreDir);

  return {
    plugins: [tsconfigPaths()],
    resolve: {
      // Derived from packages/ui's `exports` map — see vitest.ui-aliases.ts.
      alias: uiAliases(rootDir),
    },
    test: {
      globals: true,
      // happy-dom avoids jsdom@29 → html-encoding-sniffer → @exodus/bytes ERR_REQUIRE_ESM
      environment: 'happy-dom',
      fileParallelism: false,
      setupFiles: ['./app/tests/setup.ts'],
    },
  };
}
