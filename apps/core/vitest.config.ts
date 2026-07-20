import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

const coreDir = path.dirname(fileURLToPath(import.meta.url));

// Walk up from this config file's directory until we find the monorepo root
// (identified by a packages/ui subdirectory). This must work both for a
// normal run (coreDir === apps/core) and inside Stryker's sandbox, where
// this file is copied to apps/core/.stryker-tmp/sandbox-XXXX/vitest.config.ts
// (two extra levels deep) — a fixed number of '..' segments breaks in the
// sandbox case, so we search instead of hardcoding depth.
function findMonorepoRoot(startDir: string): string {
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

const rootDir = findMonorepoRoot(coreDir);

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      // More specific subpath must precede the barrel alias (prefix match).
      '@eduai/ui/term': path.resolve(rootDir, 'packages/ui/src/lib/term.ts'),
      '@eduai/ui': path.resolve(rootDir, 'packages/ui/src/index.ts'),
    },
  },
  test: {
    globals: true,
    // happy-dom avoids jsdom@29 → html-encoding-sniffer → @exodus/bytes ERR_REQUIRE_ESM
    environment: 'happy-dom',
    include: ['app/tests/unit/**/*.test.{ts,tsx}'],
    fileParallelism: false,
    setupFiles: ['./app/tests/setup.ts'],
  },
});
