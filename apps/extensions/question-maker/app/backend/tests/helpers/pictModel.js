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
 * or real DB rows) — splits into two genuinely different shapes:
 * route-level (generate-questions, variant-lifecycle-put: real Express app +
 * supertest, DB fully mocked) vs. service-level (metadata-similarity-assembly:
 * real Postgres, no HTTP/auth layer at all). Forcing both through one generic
 * helper would mean either a leaky abstraction or an interface wide enough to
 * not actually save the per-model duplication it's meant to remove, so
 * service-level models stay on their own. The two route-level models, which
 * genuinely share the same shape, are unified: session/enrollment/settings
 * mocking lives in ./pictRouteMocks.js, and the describe.each/request/status
 * row-runner lives in ./pictRouteRunner.js. Only the row-to-body/mock-state
 * mapping (what a row means for a specific route) stays per-model.
 */
export async function loadPictModel(name) {
  const rows = JSON.parse(readFileSync(path.join(repoRoot, `tests/models/${name}.cases.json`), 'utf8'));
  const oracle = await import(path.join(repoRoot, `tests/models/${name}.oracle.ts`));
  return { rows, oracle };
}
