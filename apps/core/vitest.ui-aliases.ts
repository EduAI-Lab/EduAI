import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const coreDir = path.dirname(fileURLToPath(import.meta.url));
const uiDir = path.resolve(coreDir, '../../packages/ui');

const uiExports: Record<string, string> = JSON.parse(
  readFileSync(path.join(uiDir, 'package.json'), 'utf8'),
).exports;

/**
 * `@eduai/ui` aliases for vitest, derived from the package's `exports` map so
 * the per-config copies can't drift when a subpath export is added.
 * More specific subpaths must precede the barrel alias (prefix match) — object
 * insertion order guarantees that here.
 */
export const uiAliases: Record<string, string> = {
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
