import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../..');

/**
 * Loads a PICT model's committed case table + oracle module
 * (tests/models/<name>.{cases.json,oracle.ts}). Shared by every QM PICT
 * test file for that half of the world-builder.
 *
 * The other half — building a row's actual test state (course/user/mocks,
 * or real DB rows) — is deliberately NOT unified into one generic
 * row-to-world helper here (#1188 scope decision, recorded on the issue):
 * the QM PICT models split into two genuinely different shapes — route-level
 * (generate-questions, variant-lifecycle-put: real Express app + supertest,
 * DB fully mocked) vs. service-level (metadata-similarity-assembly: real
 * Postgres, no HTTP/auth layer at all) — and forcing both through one
 * generic helper would mean either a leaky abstraction or an interface wide
 * enough to not actually save the per-model duplication it's meant to
 * remove. What IS shared across the two route-level models (session/
 * enrollment/settings mocking) already lives in ./pictRouteMocks.js.
 */
export async function loadPictModel(name) {
  const rows = JSON.parse(readFileSync(path.join(repoRoot, `tests/models/${name}.cases.json`), 'utf8'));
  const oracle = await import(path.join(repoRoot, `tests/models/${name}.oracle.ts`));
  return { rows, oracle };
}
