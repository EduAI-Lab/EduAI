import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../..');

/**
 * Loads a PICT model's committed case table + oracle module
 * (tests/models/<name>.{cases.json,oracle.ts}). Shared across all QM PICT
 * world-builders per #1188 ("QM world-builder is shared across all models
 * in this issue rather than duplicated per model").
 */
export async function loadPictModel(name) {
  const rows = JSON.parse(readFileSync(path.join(repoRoot, `tests/models/${name}.cases.json`), 'utf8'));
  const oracle = await import(path.join(repoRoot, `tests/models/${name}.oracle.ts`));
  return { rows, oracle };
}
