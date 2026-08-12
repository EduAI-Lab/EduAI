import { describe, it, expect } from 'vitest';
import request from 'supertest';

/**
 * Shared row-runner for the QM route-level PICT world-builders (#1188):
 * generate-questions and variant-lifecycle-put both hit the real Express app
 * via supertest and reduce each row to a single expected `status` (plus,
 * optionally, extra assertions once past the gate). This is the half of the
 * world-builder that IS identical across those two models — the describe.each
 * loop, the it.fails branching for known drift, issuing the request, and
 * asserting the resulting status.
 *
 * What's deliberately NOT unified here: building a row's actual test state
 * (which services/DB calls to mock, what a "row" even means for auth/course
 * access) — that's genuinely different per route and stays in `setupRow`.
 * metadata-similarity-assembly (service-level, real Postgres, no HTTP/auth
 * layer) is out of scope for this runner entirely, not just left out of an
 * interface it wouldn't fit.
 */
export function describePictRoute(name, { app, rows, method, path, setupRow, oracle, isKnownDrift, verify, label }) {
  const title = label ? `${name} PICT row #$index $label` : `${name} PICT row #$index`;
  describe.each(rows.map((row, index) => ({ row, index, label: label?.(row) })))(title, ({ row }) => {
    const run = isKnownDrift?.(row) ? it.fails : it;
    run('matches the oracle', async () => {
      const body = setupRow(row);
      const res = await request(app)
        [method](typeof path === 'function' ? path(row) : path)
        .set('Cookie', 'session=v')
        .send(body);

      const expected = oracle(row);
      expect(res.status).toBe(expected.status);

      if (verify) await verify({ row, res, expected });
    });
  });
}
