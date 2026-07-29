import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * `@eduai/ui` aliases for vitest, derived from the package's `exports` map so
 * the alias table can't drift when a subpath export is added.
 *
 * `rootDir` is the monorepo root (see `findMonorepoRoot` in `vitest.shared.ts`)
 * rather than a fixed number of '..' segments, so this still resolves inside
 * Stryker's nested sandbox.
 *
 * More specific subpaths must precede the barrel alias — vite's alias matcher
 * treats `@eduai/ui` as matching `@eduai/ui/<anything>`, so the barrel has to
 * come last. Object insertion order guarantees that here.
 */
export function uiAliases(rootDir: string): Record<string, string> {
  const uiDir = path.join(rootDir, 'packages/ui');

  const uiExports: Record<string, string> = JSON.parse(
    readFileSync(path.join(uiDir, 'package.json'), 'utf8'),
  ).exports;

  return {
    // Test-only fixture entry, not part of the public exports map.
    '@eduai/ui/term-boundary-fixtures': path.resolve(
      uiDir,
      'src/tests/fixtures/term-boundary-fixtures.ts',
    ),
    ...Object.fromEntries(
      Object.entries(uiExports)
        .filter(([key]) => key !== '.')
        .map(([key, target]) => [`@eduai/ui/${key.slice(2)}`, path.resolve(uiDir, target)]),
    ),
    '@eduai/ui': path.resolve(uiDir, uiExports['.']),
  };
}
